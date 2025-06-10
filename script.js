// ==UserScript==
// @name         Sayfa Özetleyici
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Herhangi bir web sayfasını Mistral AI ile özetleyen modern ve şık bir panel sunar.
// @author       emrxxxx
// @match        *://*/*
// @exclude      *://www.youtube.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.mistral.ai
// @require      https://cdn.jsdelivr.net/npm/marked/marked.min.js
// @require      https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js
// @icon         https://i.imgur.com/8Q6ZQ2u.png
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    if (window.trustedTypes && window.trustedTypes.createPolicy) {
        try {
            window.trustedTypes.createPolicy('default', {
                createHTML: (string) => DOMPurify.sanitize(string, { RETURN_TRUSTED_TYPE: true }),
            });
        } catch (e) { /* Politika zaten varsa sorun değil */ }
    }

    const CONFIG = {
        API_KEY: GM_getValue('mistral_api_key', ''),
        MODEL: 'mistral-small-latest',
        CHUNK_SIZE: 15000,
        TEMPERATURE: 0.4,
    };

    let summaryPanel = null;
    let isLoading = false;

    GM_registerMenuCommand('🔑 API Anahtarını Ayarla', setApiKey);
    GM_registerMenuCommand('🗑️ Ayarları Sıfırla', resetSettings);

    function setApiKey() {
        const newKey = prompt('Lütfen Mistral API anahtarınızı girin:', CONFIG.API_KEY);
        if (newKey !== null) {
            GM_setValue('mistral_api_key', newKey.trim());
            CONFIG.API_KEY = newKey.trim();
            alert('API anahtarı başarıyla kaydedildi!');
        }
    }

    function resetSettings() {
        if (confirm('Tüm ayarları sıfırlamak istediğinize emin misiniz? Bu işlem API anahtarınızı da silecektir.')) {
            GM_setValue('mistral_api_key', '');
            CONFIG.API_KEY = '';
            alert('Ayarlar sıfırlandı!');
        }
    }

    function createSummaryButton() {
        if (document.getElementById('summary-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'summary-btn';
        btn.innerHTML = '📄';
        btn.title = 'Sayfayı Özetle (Ctrl+Shift+S)';
        Object.assign(btn.style, {
            position: 'fixed', bottom: '30px', right: '30px', width: '40px', height: '40px',
            borderRadius: '50%', border: 'none', background: '#2a2a2a', color: 'white',
            fontSize: '16px', cursor: 'pointer', boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
            zIndex: '2147483640', transition: 'all 0.3s ease', display: 'flex', alignItems: 'center',
            justifyContent: 'center', opacity: '0.9', padding: '0', lineHeight: '1',
        });

        // DEĞİŞİKLİK: Mouseover rengi mavi yapıldı.
        btn.addEventListener('mouseover', () => { btn.style.background = '#0984e3'; btn.style.transform = 'scale(1.1) rotate(5deg)'; btn.style.opacity = '1'; });
        btn.addEventListener('mouseout', () => { btn.style.background = '#2a2a2a'; btn.style.transform = 'scale(1) rotate(0deg)'; btn.style.opacity = '0.9'; });
        btn.addEventListener('click', handleSummarizeClick);

        document.body.appendChild(btn);

        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
                e.preventDefault();
                handleSummarizeClick();
            }
        });

        const style = document.createElement('style');
        style.textContent = `
            @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.05); } 100% { transform: scale(1); } }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            #summary-btn:not(:hover) { animation: pulse 2s infinite; }
            #summary-panel { transition: transform 0.4s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s; }
            #summary-content h1, #summary-content h2, #summary-content h3, #summary-content h4 { color: #ff9f43; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 4px; }
            #summary-content h3 { font-size: 1.1em; margin-top: 1em; margin-bottom: 0.5em; }
            #summary-content h4 { font-size: 1.0em; margin-top: 0.8em; margin-bottom: 0.4em; }
            #summary-content ul, #summary-content ol { padding-left: 20px; }
            #summary-content li { margin-bottom: 8px; }
            #summary-content strong, b { color: #f0f0f0; font-weight: 600; }
            #summary-content code { background-color: rgba(0,0,0,0.3); padding: 2px 4px; border-radius: 4px; font-family: 'Courier New', Courier, monospace; }
            #summary-content::-webkit-scrollbar { width: 6px; }
            #summary-content::-webkit-scrollbar-track { background: rgba(255,255,255,0.1); }
            #summary-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.3); border-radius: 3px; }
        `;
        document.head.appendChild(style);
    }

    function createSummaryPanel() {
        if (summaryPanel) return summaryPanel;

        summaryPanel = document.createElement('div');
        summaryPanel.id = 'summary-panel';
        summaryPanel.style.cssText = `
            position: fixed; top: 80px; right: 85px; width: 42vh; max-height: calc(100vh - 110px);
            background: rgba(42, 42, 42, 0.9); border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            z-index: 2147483641; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: white; backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1);
            overflow: hidden; display: flex; flex-direction: column;
            transform: translateX(calc(100% + 90px)); opacity: 0;
        `;

        const header = document.createElement('div');
        header.style.cssText = `padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.2); display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.3); cursor: move; flex-shrink: 0;`;
        const title = document.createElement('h3');
        title.textContent = '📄 Sayfa Özeti';
        title.style.cssText = 'margin: 0; font-size: 15px; font-weight: 500; color: white; border: none;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `background: none; border: none; color: white; font-size: 20px; cursor: pointer; opacity: 0.8; transition: opacity 0.2s; line-height: 1; padding: 0 4px;`;
        closeBtn.addEventListener('click', hideSummaryPanel);
        header.append(title, closeBtn);

        const content = document.createElement('div');
        content.id = 'summary-content';
        content.style.cssText = `padding: 16px; overflow-y: auto; line-height: 1.5; font-size: 14px; flex-grow: 1;`;
        content.textContent = 'Özet bekleniyor...';

        summaryPanel.append(header, content);
        document.body.appendChild(summaryPanel);

        makeDraggable(summaryPanel, header);
        return summaryPanel;
    }

    function updateSummaryPanel(htmlContent, { isError = false, isLoading = false } = {}) {
        const panelContent = document.getElementById('summary-content');
        if (!panelContent) return;

        panelContent.style.color = isError ? '#ff6b6b' : 'inherit';

        if (isError || isLoading) {
            panelContent.textContent = htmlContent;
        } else {
            const cleanHtml = DOMPurify.sanitize(htmlContent, { RETURN_TRUSTED_TYPE: true });
            panelContent.innerHTML = cleanHtml;
        }
    }

    function showSummaryPanel() {
        if (!summaryPanel) createSummaryPanel();
        requestAnimationFrame(() => { summaryPanel.style.transform = 'translateX(0)'; summaryPanel.style.opacity = '1'; });
    }

    function hideSummaryPanel() {
        if (!summaryPanel) return;
        summaryPanel.style.transform = `translateX(calc(100% + 90px))`;
        summaryPanel.style.opacity = '0';
    }

    function extractPageContent() {
        const bodyClone = document.body.cloneNode(true);
        const unwantedSelectors = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'form', 'iframe', '[aria-hidden="true"]', '.ad', '.advertisement', '.popup', '.modal'];
        bodyClone.querySelectorAll(unwantedSelectors.join(',')).forEach(el => el.remove());

        const mainContentSelectors = ['article', 'main', '[role="main"]', '.post-content', '.entry-content', '#content'];
        let mainElement = null;
        for (const selector of mainContentSelectors) {
            mainElement = bodyClone.querySelector(selector);
            if (mainElement) break;
        }

        const textSource = mainElement || bodyClone;
        return textSource.textContent.replace(/\s+/g, ' ').trim();
    }

    async function handleSummarizeClick() {
        if (isLoading) return;
        isLoading = true;

        const btn = document.getElementById('summary-btn');
        btn.textContent = '⏳';
        btn.style.animation = 'spin 1s linear infinite';

        createSummaryPanel();
        showSummaryPanel();
        // DEĞİŞİKLİK: Yükleme mesajı basitleştirildi ve ara durumlar kaldırıldı.
        updateSummaryPanel('Sayfa özetleniyor...\nBu işlem sayfanın uzunluğuna göre biraz zaman alabilir.', { isLoading: true });

        try {
            if (!CONFIG.API_KEY) throw new Error('Lütfen Tampermonkey menüsünden API anahtarınızı ayarlayın.');

            const content = extractPageContent();
            if (!content || content.length < 200) throw new Error('Özetlemek için yeterli metin içeriği bulunamadı.');

            const chunks = [];
            for (let i = 0; i < content.length; i += CONFIG.CHUNK_SIZE) {
                chunks.push(content.substring(i, i + CONFIG.CHUNK_SIZE));
            }

            let summary;
            if (chunks.length === 1) {
                summary = await processApiRequest(chunks[0], 'initial');
            } else {
                const intermediateSummaries = [];
                for (const chunk of chunks) {
                    const intermediateSummary = await processApiRequest(chunk, 'intermediate');
                    intermediateSummaries.push(intermediateSummary);
                }
                const combinedIntermediate = intermediateSummaries.join('\n\n---\n\n');
                summary = await processApiRequest(combinedIntermediate, 'final');
            }

            const finalHtml = marked.parse(summary);
            updateSummaryPanel(finalHtml);

        } catch (error) {
            console.error('[Sayfa Özetleyici] Hata:', error);
            updateSummaryPanel(`❌ Hata: ${error.message}`, { isError: true });
        } finally {
            isLoading = false;
            btn.textContent = '📄';
            btn.style.animation = '';
        }
    }

    function processApiRequest(text, type) {
        let system_prompt;
        switch(type) {
            case 'initial':
                system_prompt = `You are an expert summarizer. Analyze the following webpage content and provide a detailed, well-structured summary in Turkish using Markdown. Use headings (###), bullet points (*), and bold text (**) to highlight key information.`;
                break;
            case 'intermediate':
                system_prompt = `You are part of a summarization pipeline. Summarize the following text chunk in Turkish. Focus on extracting all key facts, arguments, and data. The output will be used to create a final summary.`;
                break;
            case 'final':
                system_prompt = `You are an expert editor. The following text consists of several partial summaries of a single webpage. Your task is to synthesize them into a single, cohesive, and well-structured final summary in Turkish. Use Markdown for formatting (headings, lists, bold). Remove redundancies and create a fluid narrative.`;
                break;
        }

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://api.mistral.ai/v1/chat/completions',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.API_KEY}` },
                data: JSON.stringify({
                    model: CONFIG.MODEL,
                    messages: [ { role: 'system', content: system_prompt }, { role: 'user', content: text } ],
                    temperature: CONFIG.TEMPERATURE,
                }),
                timeout: 60000,
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        const data = JSON.parse(response.responseText);
                        const content = data.choices?.[0]?.message?.content;
                        if (content) resolve(content.trim());
                        else reject(new Error('API yanıtı boş veya geçersiz.'));
                    } else {
                        const errorData = JSON.parse(response.responseText);
                        reject(new Error(errorData.error?.message || `API Hatası (${response.status})`));
                    }
                },
                onerror: () => reject(new Error('Ağ hatası veya API\'ye ulaşılamıyor.')),
                ontimeout: () => reject(new Error('API isteği zaman aşımına uğradı (60 saniye).'))
            });
        });
    }

    function makeDraggable(element, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        handle.onmousedown = (e) => {
            e.preventDefault(); pos3 = e.clientX; pos4 = e.clientY;
            document.onmouseup = closeDragElement; document.onmousemove = elementDrag;
        };
        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY;
            pos3 = e.clientX; pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
            element.style.right = 'auto'; element.style.bottom = 'auto';
        }
        function closeDragElement() {
            document.onmouseup = null; document.onmousemove = null;
        }
    }

    if (window.self === window.top) {
        createSummaryButton();
    }
})();
