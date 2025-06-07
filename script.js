// ==UserScript==
// @name         Sayfa Özetleyici
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Sayfayı Mistral API ile özetleyen compact panel
// @author       emrxxxx
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @icon         https://i.imgur.com/8Q6ZQ2u.png
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    // Yapılandırma Ayarları
    const CONFIG = {
        API_KEY: GM_getValue('mistral_api_key', ''),
        MODEL: 'codestral-latest',
        CHUNK_SIZE: 30000,
        MAX_TOKENS: 2000,
        TEMPERATURE: 0.3,
        PROMPT: `Aşağıdaki metni Türkçe olarak profesyonel ve akademik düzeyde özetleyin. Özet şu özelliklere sahip olmalıdır:

1. **Yapı**: Ana başlıklar (##) ve alt başlıklar (###) kullanın
2. **İçerik**: Temel argümanları, verileri ve önemli noktaları vurgulayın
3. **Stil**: Net, anlaşılır ve tarafsız bir dil kullanın
4. **Uzunluk**: Orijinal içeriğin %15-20'si uzunluğunda
5. **Format**: Markdown formatında düzenleyin

Önemli:
- Teknik terimleri açıklayın
- Anahtar istatistikleri koruyun
- Yazarın bakış açısını yansıtın
- Gereksiz detayları atlayın

Metin:`
    };

    // UI Elementleri
    let summaryPanel = null;
    let isLoading = false;
    let pageContent = '';

    // Menü Komutlarını Kaydet
    GM_registerMenuCommand('API Anahtarını Ayarla', setApiKey);
    GM_registerMenuCommand('Ayarları Sıfırla', resetSettings);

    function setApiKey() {
        const newKey = prompt('Mistral API Anahtarınızı Girin:', CONFIG.API_KEY);
        if (newKey !== null) {
            GM_setValue('mistral_api_key', newKey.trim());
            CONFIG.API_KEY = newKey.trim();
            alert('API anahtarı başarıyla kaydedildi!');
        }
    }

    function resetSettings() {
        if (confirm('Tüm ayarları sıfırlamak istediğinize emin misiniz?')) {
            GM_setValue('mistral_api_key', '');
            CONFIG.API_KEY = '';
            alert('Ayarlar sıfırlandı!');
        }
    }

    // Markdown Parser
    function parseMarkdown(text) {
        if (!text) return '';

        return text
            .replace(/^#### (.*$)/gim, '<h4 style="margin: 8px 0 4px 0; font-size: 14px; color: #fff;">$1</h4>')
            .replace(/^### (.*$)/gim, '<h3 style="margin: 10px 0 5px 0; font-size: 15px; color: #fff;">$1</h3>')
            .replace(/^## (.*$)/gim, '<h2 style="margin: 12px 0 6px 0; font-size: 16px; color: #fff;">$1</h2>')
            .replace(/^# (.*$)/gim, '<h1 style="margin: 15px 0 8px 0; font-size: 18px; color: #fff;">$1</h1>')
            .replace(/\*\*(.*?)\*\*/g, '<strong style="font-weight: bold; color: #fff;">$1</strong>')
            .replace(/\*(.*?)\*/g, '<em style="font-style: italic; color: #f0f0f0;">$1</em>')
            .replace(/```([\s\S]*?)```/g, '<pre style="background: rgba(255,255,255,0.1); padding: 8px; border-radius: 4px; margin: 6px 0; overflow-x: auto; font-family: monospace; font-size: 12px; color: #e0e0e0;">$1</pre>')
            .replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 2px; font-family: monospace; font-size: 12px; color: #e0e0e0;">$1</code>')
            .replace(/\n\s*-\s+(.*)/g, '<li style="margin: 2px 0; padding-left: 4px;">$1</li>')
            .replace(/\n\s*\*\s+(.*)/g, '<li style="margin: 2px 0; padding-left: 4px;">$1</li>')
            .replace(/\n\s*\d+\.\s+(.*)/g, '<li style="margin: 2px 0; padding-left: 4px;">$1</li>')
            .replace(/\n{2,}/g, '<br>');
    }

    function wrapLists(html) {
        return html.replace(/(<li[^>]*>.*?<\/li>)+/g, function(match) {
            return `<ul style="margin: 4px 0; padding-left: 16px; list-style-type: disc;">${match}</ul>`;
        });
    }

    // UI Fonksiyonları
    function createSummaryPanel() {
        if (summaryPanel) return summaryPanel;

        const panel = document.createElement('div');
        panel.id = 'summary-panel';
        panel.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            width: 380px;
            max-height: calc(100vh - 100px);
            background: #2a2a2a;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            z-index: 10001;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: white;
            backdrop-filter: blur(10px);
            transform: translateX(400px);
            transition: transform 0.3s ease;
            overflow: hidden;
            opacity: 0.95;
            border: 1px solid rgba(255,255,255,0.1);
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 12px 16px;
            border-bottom: 1px solid rgba(255,255,255,0.2);
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(0,0,0,0.3);
            cursor: move;
        `;

        const title = document.createElement('h3');
        title.textContent = '📄 Sayfa Özeti';
        title.style.cssText = 'margin: 0; font-size: 15px; font-weight: 500;';

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: white;
            font-size: 18px;
            cursor: pointer;
            opacity: 0.8;
            transition: opacity 0.2s;
            line-height: 1;
            padding: 0 4px;
        `;
        closeBtn.addEventListener('mouseover', () => closeBtn.style.opacity = '1');
        closeBtn.addEventListener('mouseout', () => closeBtn.style.opacity = '0.8');
        closeBtn.addEventListener('click', hideSummaryPanel);

        header.appendChild(title);
        header.appendChild(closeBtn);

        const content = document.createElement('div');
        content.id = 'summary-content';
        content.style.cssText = `
            padding: 16px;
            max-height: calc(100vh - 150px);
            overflow-y: auto;
            line-height: 1.4;
            font-size: 13.5px;
        `;

        // Sürükle-bırak özelliği
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        header.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e = e || window.event;
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            panel.style.top = (panel.offsetTop - pos2) + "px";
            panel.style.left = (panel.offsetLeft - pos1) + "px";
            panel.style.right = 'auto';
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }

        panel.appendChild(header);
        panel.appendChild(content);
        document.body.appendChild(panel);

        // Scrollbar styling
        const style = document.createElement('style');
        style.textContent = `
            #summary-content::-webkit-scrollbar { width: 6px; }
            #summary-content::-webkit-scrollbar-track { background: rgba(255,255,255,0.1); }
            #summary-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.3); border-radius: 3px; }
            #summary-content::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.5); }
        `;
        document.head.appendChild(style);

        return panel;
    }

    function createSummaryButton() {
        if (document.getElementById('summary-btn')) return;

        const button = document.createElement('button');
        button.id = 'summary-btn';
        button.innerHTML = '📋';
        button.title = 'Sayfayı Özetle (Ctrl+Shift+S)';
        button.style.cssText = `
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: none;
            background: #2a2a2a;
            color: white;
            font-size: 16px;
            cursor: pointer;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            z-index: 9999;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0.9;
        `;

        button.addEventListener('mouseover', () => {
            button.style.transform = 'scale(1.1)';
            button.style.boxShadow = '0 6px 25px rgba(0, 0, 0, 0.7)';
            button.style.opacity = '1';
        });

        button.addEventListener('mouseout', () => {
            button.style.transform = 'scale(1)';
            button.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.5)';
            button.style.opacity = '0.9';
        });

        button.addEventListener('click', summarizePage);
        document.body.appendChild(button);

        // Klavye kısayolu ekle
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'S') {
                e.preventDefault();
                summarizePage();
            }
        });
    }

    // İçerik İşleme Fonksiyonları
    function extractPageContent() {
        console.log('[Sayfa Özetleyici] İçerik çıkarılıyor...');

        // Önce hedef elementleri bulmaya çalış
        const contentSelectors = [
            'article', '[role="main"]', 'main', '.content', '.post-content',
            '.entry-content', '.article-content', '#content', '.main-content',
            '.story-content', '.body-content', '.text-content'
        ];

        for (const selector of contentSelectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent.trim().length > 500) {
                pageContent = cleanText(element.textContent);
                console.log(`[Sayfa Özetleyici] İçerik ${selector} elementinden alındı`);
                return;
            }
        }

        // Fallback: Body'den temizlenmiş içerik
        const bodyClone = document.body.cloneNode(true);
        const unwantedSelectors = [
            'script', 'style', 'nav', 'header', 'footer', 'aside',
            '.ad', '.advertisement', '.sidebar', 'iframe', 'form',
            '.comments', '.related', '.social', '.newsletter',
            '.cookie-consent', '.modal', '.popup'
        ];

        unwantedSelectors.forEach(selector => {
            bodyClone.querySelectorAll(selector).forEach(el => el.remove());
        });

        pageContent = cleanText(bodyClone.textContent);
        console.log('[Sayfa Özetleyici] İçerik body elementinden alındı');
    }

    function cleanText(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n')
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            .replace(/\[.*?\]/g, '') // Köşeli parantez içindekileri kaldır
            .replace(/\b(\w+)\s+\1\b/gi, '$1') // Tekrar eden kelimeleri kaldır
            .replace(/\s+([.,!?])/g, '$1') // Noktalama işaretlerinden önceki boşlukları kaldır
            .trim();
    }

    // API Fonksiyonları
    async function summarizeWithMistral() {
        if (!CONFIG.API_KEY) {
            throw new Error('Lütfen önce API anahtarını ayarlayın (Tampermonkey menüsünden)');
        }

        if (!pageContent || pageContent.length < 100) {
            throw new Error('Yeterli içerik bulunamadı');
        }

        console.log('[Sayfa Özetleyici] Özetleme başlıyor...');
        const chunks = chunkContent(pageContent);
        const summaries = [];

        for (const [index, chunk] of chunks.entries()) {
            try {
                console.log(`[Sayfa Özetleyici] ${index + 1}/${chunks.length} parça işleniyor...`);
                const summary = await processChunk(chunk, index + 1, chunks.length);
                summaries.push(summary);
            } catch (error) {
                console.error(`[Sayfa Özetleyici] ${index + 1}. parça hatası:`, error);
                throw error;
            }
        }

        return summaries.join('\n\n');
    }

    function chunkContent(content) {
        const chunks = [];
        for (let i = 0; i < content.length; i += CONFIG.CHUNK_SIZE) {
            chunks.push(content.substring(i, i + CONFIG.CHUNK_SIZE));
        }
        return chunks;
    }

    function processChunk(chunk, current, total) {
        return new Promise((resolve, reject) => {
            const fullPrompt = `${CONFIG.PROMPT}\n\n${chunk}`;

            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://api.mistral.ai/v1/chat/completions',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${CONFIG.API_KEY}`
                },
                data: JSON.stringify({
                    model: CONFIG.MODEL,
                    messages: [{
                        role: 'user',
                        content: fullPrompt
                    }],
                    temperature: CONFIG.TEMPERATURE,
                    max_tokens: CONFIG.MAX_TOKENS
                }),
                timeout: 30000,
                onload: function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.choices?.[0]?.message?.content) {
                            resolve(data.choices[0].message.content.trim());
                        } else {
                            reject(new Error(`Geçersiz API yanıtı: ${JSON.stringify(data)}`));
                        }
                    } catch (e) {
                        reject(new Error(`API yanıtı ayrıştırılamadı: ${e.message}`));
                    }
                },
                onerror: function(error) {
                    reject(new Error(`API isteği başarısız: ${error.statusText || 'Bilinmeyen hata'}`));
                },
                ontimeout: function() {
                    reject(new Error('API isteği zaman aşımına uğradı'));
                }
            });
        });
    }

    // Ana Fonksiyonlar
    async function summarizePage() {
        if (isLoading) {
            console.log('[Sayfa Özetleyici] Zaten çalışıyor...');
            return;
        }

        isLoading = true;
        const button = document.getElementById('summary-btn');
        const originalHTML = button.innerHTML;

        try {
            // Butonu yükleme durumuna getir
            button.innerHTML = '⏳';
            button.style.animation = 'spin 1s linear infinite';

            // Spin animasyonu ekle
            if (!document.getElementById('spin-animation')) {
                const style = document.createElement('style');
                style.id = 'spin-animation';
                style.textContent = `
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }

            // Panel oluştur/göster
            if (!summaryPanel) {
                summaryPanel = createSummaryPanel();
            }
            showSummaryPanel();

            // İçerik alanını ayarla
            const contentDiv = document.getElementById('summary-content');
            contentDiv.innerHTML = `
                <div style="text-align: center; padding: 20px; opacity: 0.8;">
                    <div style="margin-bottom: 10px;">⏳ Sayfa özetleniyor...</div>
                    <div style="font-size: 12px; opacity: 0.7;">${document.title}</div>
                </div>
            `;

            // İçeriği çıkar ve özetle
            extractPageContent();
            const summary = await summarizeWithMistral();

            // Sonucu göster
            const processedSummary = wrapLists(parseMarkdown(summary));
            contentDiv.innerHTML = `
                <div style="margin-bottom: 12px; padding: 10px; background: rgba(255,255,255,0.1);
                    border-radius: 6px; font-size: 12px; border-left: 4px solid #87ceeb;">
                    📍 <strong>Sayfa:</strong> ${document.title}<br>
                </div>
                <div style="line-height: 1.4; font-size: 13.5px;">${processedSummary}</div>
            `;

            adjustPanelHeight();

        } catch (error) {
            console.error('[Sayfa Özetleyici] Özetleme hatası:', error);
            showError(error.message);
        } finally {
            // Butonu eski haline getir
            button.innerHTML = originalHTML;
            button.style.animation = '';
            isLoading = false;
        }
    }

    function showError(message) {
        if (!summaryPanel) return;

        const contentDiv = document.getElementById('summary-content');
        contentDiv.innerHTML = `
            <div style="color: #ff6b6b; padding: 15px; text-align: center;">
                <div style="font-size: 24px; margin-bottom: 10px;">❌</div>
                <div style="font-weight: bold; margin-bottom: 10px;">Hata oluştu!</div>
                <div style="font-size: 13px; margin-bottom: 15px;">${message}</div>
                ${!CONFIG.API_KEY ?
                    '<button onclick="window.location.reload()" style="background: #ff6b6b; border: none; color: white; padding: 8px 15px; border-radius: 4px; cursor: pointer;">API Anahtarını Ayarla</button>' :
                    '<button onclick="summarizePage()" style="background: #4CAF50; border: none; color: white; padding: 8px 15px; border-radius: 4px; cursor: pointer;">Tekrar Dene</button>'}
            </div>
        `;

        adjustPanelHeight();
    }

    function adjustPanelHeight() {
        if (!summaryPanel) return;

        const contentDiv = document.getElementById('summary-content');
        const headerHeight = summaryPanel.querySelector('div').offsetHeight;
        const contentHeight = contentDiv.scrollHeight;
        const maxHeight = window.innerHeight - 40;

        summaryPanel.style.height = `${Math.min(contentHeight + headerHeight + 20, maxHeight)}px`;
    }

    function showSummaryPanel() {
        if (summaryPanel) {
            summaryPanel.style.transform = 'translateX(0)';
        }
    }

    function hideSummaryPanel() {
        if (summaryPanel) {
            summaryPanel.style.transform = 'translateX(400px)';
        }
    }

    // Uygulamayı Başlat
    function init() {
        createSummaryButton();

        // Sayfa değişikliklerini izle (SPA'lar için)
        const observer = new MutationObserver(() => {
            if (!document.getElementById('summary-btn')) {
                createSummaryButton();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
