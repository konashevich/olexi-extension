// content.js (Redesigned: agent-led, MCP-host style; no server-side AI calls)

(function() {
    if (document.getElementById('olexi-chat-container')) return; // run once

    // --- Authorization (host-side only) ---
    async function getApiKey() {
        return await new Promise((resolve, reject) => {
            try {
                chrome.storage?.local.get(['olexi_api_key'], (items) => {
                    const existing = items?.olexi_api_key;
                    if (existing && typeof existing === 'string' && existing.trim()) return resolve(existing.trim());
                    const entered = window.prompt('Enter your Olexi API key to authorize the extension:');
                    if (!entered || !entered.trim()) return reject(new Error('Missing API key'));
                    const key = entered.trim();
                    try { chrome.storage?.local.set({ olexi_api_key: key }, () => resolve(key)); } catch { resolve(key); }
                });
            } catch (e) {
                try {
                    let key = localStorage.getItem('olexi_api_key');
                    if (!key) {
                        const entered = window.prompt('Enter your Olexi API key to authorize the extension:');
                        if (!entered || !entered.trim()) return reject(new Error('Missing API key'));
                        key = entered.trim();
                        localStorage.setItem('olexi_api_key', key);
                    }
                    resolve(key);
                } catch (err) { reject(err); }
            }
        });
    }

    // --- UI ---
    const chatContainer = document.createElement('div');
    chatContainer.id = 'olexi-chat-container';
    chatContainer.innerHTML = `
        <div id="olexi-header">
            <div class="logo">
                <div>
                    <div>Olexi AI</div>
                    <div class="subtitle">Legal Research Assistant (MCP Host)</div>
                </div>
            </div>
        </div>
        <div class="olexi-welcome">
            <h3>Welcome to Olexi</h3>
            <p>Enter a legal research prompt. Olexi will search AustLII using MCP tools. No server-side AI is used.</p>
            <p><small>Tip: Press Ctrl+Enter to send.</small></p>
        </div>
        <div id="olexi-messages"></div>
        <form id="olexi-input-form">
            <textarea id="olexi-input" placeholder="e.g., Recent HCA cases on unconscionable conduct" title="Press Ctrl+Enter to send" rows="2"></textarea>
            <button id="olexi-send-btn" type="submit">Search</button>
        </form>
    `;

    const toggleButton = document.createElement('button');
    toggleButton.id = 'olexi-toggle-btn';
    toggleButton.textContent = '\u25c0 Hide';
    toggleButton.setAttribute('title', 'Toggle Olexi Panel');

    document.body.appendChild(chatContainer);
    document.body.appendChild(toggleButton);

    const messagesContainer = document.getElementById('olexi-messages');
    const inputForm = document.getElementById('olexi-input-form');
    const inputField = document.getElementById('olexi-input');
    const toggleBtn = document.getElementById('olexi-toggle-btn');
    // No database filter in primary UX

    // Toggle
    let isCollapsed = false;
    toggleBtn.addEventListener('click', () => {
        isCollapsed = !isCollapsed;
        if (isCollapsed) {
            document.body.classList.add('olexi-collapsed');
            chatContainer.classList.add('collapsed');
            toggleBtn.classList.add('collapsed');
            toggleBtn.textContent = '\u25b6 Show Olexi';
        } else {
            document.body.classList.remove('olexi-collapsed');
            chatContainer.classList.remove('collapsed');
            toggleBtn.classList.remove('collapsed');
            toggleBtn.textContent = '\u25c0 Hide';
        }
    });

    // Auto-resize textarea
    inputField.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    // Keyboard shortcuts
    inputField.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); inputForm.dispatchEvent(new Event('submit')); }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'O') { e.preventDefault(); toggleBtn.click(); }
    });
    document.addEventListener('keydown', function(e) { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'O') { e.preventDefault(); toggleBtn.click(); } });

    // No database selection UI

    // --- Submit flow: host-orchestrated, streaming session to backend ---
    inputForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const userPrompt = inputField.value.trim();
        if (!userPrompt) return;
        displayMessage(userPrompt, 'user');
        inputField.value = ''; inputField.style.height = 'auto';
        showLoadingIndicator();
        try {
            const apiKey = await getApiKey();
            await streamSession(userPrompt, apiKey);
        } catch (error) {
            removeLoadingIndicator();
            console.error('Olexi Error:', error);
            let msg = typeof error?.message === 'string' ? error.message : 'Something went wrong.';
            if (/AustLII is not accessible/i.test(msg)) msg = 'AustLII is not responding. Please try again later.';
            displayMessage(msg, 'ai');
        }
    });

    // --- Streaming SSE over POST to /session/research ---
    async function streamSession(prompt, apiKey) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);
        let shareUrl = null;
        try {
            const res = await fetch('http://127.0.0.1:3000/session/research', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                    'X-API-Key': apiKey,
                    'X-Extension-Id': 'olexi-local'
                },
                body: JSON.stringify({ prompt }),
                signal: controller.signal,
            });
            if (!res.ok || !res.body) {
                let detail = '';
                try { detail = await res.text(); } catch {}
                throw new Error(detail || res.statusText || `HTTP ${res.status}`);
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let idx;
                while ((idx = buffer.indexOf('\n\n')) >= 0) {
                    const raw = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 2);
                    const lines = raw.split('\n');
                    let event = null;
                    let data = '';
                    for (const line of lines) {
                        if (line.startsWith('event:')) event = line.slice(6).trim();
                        else if (line.startsWith('data:')) data += line.slice(5).trim();
                    }
                    if (!event) continue;
                    try {
                        const payload = data ? JSON.parse(data) : {};
                        if (event === 'progress') {
                            // Could update loading text here
                        } else if (event === 'results_preview') {
                            removeLoadingIndicator();
                            const items = Array.isArray(payload.items) ? payload.items : [];
                            const md = renderResultsMarkdown(items);
                            displayMessage(md, 'ai');
                        } else if (event === 'answer') {
                            removeLoadingIndicator();
                            shareUrl = payload.url || null;
                            const md = typeof payload.markdown === 'string' ? payload.markdown : 'No answer.';
                            displayMessage(md, 'ai', shareUrl);
                        } else if (event === 'error') {
                            removeLoadingIndicator();
                            const msg = payload.detail || 'Error during research session.';
                            displayMessage(msg, 'ai');
                        }
                    } catch (e) {
                        // ignore parse errors for partial chunks
                    }
                }
            }
            clearTimeout(timeoutId);
        } catch (e) {
            clearTimeout(timeoutId);
            throw e;
        }
    }

    // --- Rendering ---
    function renderResultsMarkdown(results) {
        if (!Array.isArray(results) || results.length === 0) return 'No results found.';
        const top = results.slice(0, 10);
        const items = top.map((r, i) => `- [${escapeMd(r.title || 'Untitled')}](${r.url})${r.metadata ? ` — ${escapeMd(r.metadata)}` : ''}`);
        const extra = results.length > 10 ? `\n\n…and ${results.length - 10} more.` : '';
        return `Top results:\n\n${items.join('\n')}${extra}`;
    }

    function escapeMd(s) {
        return String(s).replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&');
    }

    function displayMessage(text, sender, searchUrl = null) {
        const welcomeMsg = document.querySelector('.olexi-welcome');
        if (welcomeMsg && sender === 'user') welcomeMsg.style.display = 'none';
        const el = document.createElement('div');
        el.classList.add('olexi-message', `${sender}-message`);
        let htmlText = text.replace(/\n/g, '<br>');
        htmlText = htmlText.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
        el.innerHTML = htmlText;
        if (sender === 'ai' && searchUrl) {
            const link = document.createElement('a');
            link.href = searchUrl; link.target = '_blank';
            link.textContent = '\ud83d\udcc4 View full search results on AustLII';
            link.style.display = 'block'; link.style.marginTop = '12px'; link.style.fontWeight = 'bold';
            link.style.padding = '8px 12px'; link.style.backgroundColor = '#f1f5f9'; link.style.borderRadius = '8px';
            link.style.textDecoration = 'none'; link.style.color = '#1e293b'; link.style.fontSize = '13px';
            el.appendChild(link);
        }
        messagesContainer.appendChild(el);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Delegate clicks on special olexi://ask links to trigger a new session with the link text as the prompt
    messagesContainer.addEventListener('click', async (e) => {
        const a = e.target?.closest('a');
        if (!a) return;
        try {
            const url = new URL(a.getAttribute('href'));
            if (url.protocol === 'olexi:' && url.hostname === 'ask') {
                e.preventDefault();
                const prompt = a.textContent?.trim();
                if (!prompt) return;
                displayMessage(prompt, 'user');
                showLoadingIndicator();
                const apiKey = await getApiKey();
                await streamSession(prompt, apiKey);
            }
        } catch {
            // ignore non-URL or unsupported
        }
    });

    function showLoadingIndicator() {
        const el = document.createElement('div');
        el.id = 'olexi-loading';
        el.classList.add('olexi-message', 'ai-message');
        el.innerHTML = '\ud83d\udd0d Searching Australian legal databases...<br><small>This may take 30-60 seconds for comprehensive results</small>';
        messagesContainer.appendChild(el);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function removeLoadingIndicator() {
        const el = document.getElementById('olexi-loading');
        if (el) el.remove();
    }
})();