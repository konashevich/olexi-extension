// content.js (Redesigned: agent-led, MCP-host style; no server-side AI calls)

(function() {
    // Build-time switch: when packaging for the Chrome Web Store the packager
    // will replace ALLOW_LOCAL_PROBES = true with false to avoid probing
    // developer localhost endpoints in the published build.
    const ALLOW_LOCAL_PROBES = false; // replaced to false for release builds

    if (document.getElementById('olexi-chat-container')) return; // run once

    // --- Chat state ---
    const chatHistory = []; // { role: 'user'|'ai', content: string, ts: number }

    // Generate unique installation fingerprint
    let installationFingerprint = null;
    let sessionToken = null;
    
    async function generateInstallationFingerprint() {
        if (installationFingerprint) return installationFingerprint;
        
        try {
            // Create a canvas fingerprint
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillText('Olexi Extension Fingerprint', 2, 2);
            
            const fingerprint = {
                canvasFingerprint: canvas.toDataURL(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                language: navigator.language,
                platform: navigator.platform,
                screen: `${screen.width}x${screen.height}`,
                userAgent: navigator.userAgent.substring(0, 100), // Truncate for consistency
                extensionOrigin: window.location.origin
            };
            
            // Create a hash of these values
            const encoder = new TextEncoder();
            const data = encoder.encode(JSON.stringify(fingerprint));
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            installationFingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
            
            return installationFingerprint;
        } catch (error) {
            console.warn('Failed to generate fingerprint:', error);
            // Fallback to a simpler fingerprint
            installationFingerprint = btoa(navigator.userAgent + screen.width + screen.height).substring(0, 32);
            return installationFingerprint;
        }
    }

    async function getOrCreateSessionToken() {
        if (sessionToken) return sessionToken;
        
        // Try to get existing token from localStorage
        const storedToken = localStorage.getItem('olexi-session-token');
        if (storedToken) {
            // Validate stored token
            try {
                const base = await resolveHostBase();
                const fingerprint = await generateInstallationFingerprint();
                
                const response = await fetch(base + '/session/token/info', {
                    method: 'GET',
                    headers: {
                        'X-Session-Token': storedToken,
                        'X-Extension-Fingerprint': fingerprint
                    },
                    mode: 'cors',
                    credentials: 'omit'
                });
                
                if (response.ok) {
                    sessionToken = storedToken;
                    return sessionToken;
                }
            } catch (error) {
                console.warn('Stored token validation failed:', error);
            }
        }
        
        // Generate new token
        try {
            const base = await resolveHostBase();
            const fingerprint = await generateInstallationFingerprint();
            
            const response = await fetch(base + '/session/token', {
                method: 'POST',
                headers: {
                        'Content-Type': 'application/json',
                        // IMPORTANT: Security validator requires this header to allow the request
                        'X-Extension-Fingerprint': fingerprint,
                        // Optional future use / parity with research endpoint
                        'X-Extension-Id': 'olexi-local'
                },
                mode: 'cors',
                credentials: 'omit',
                body: JSON.stringify({ fingerprint })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to get session token: ${response.status}`);
            }
            
            const data = await response.json();
            sessionToken = data.token;
            
            // Store token in localStorage
            localStorage.setItem('olexi-session-token', sessionToken);
            
            return sessionToken;
        } catch (error) {
            console.error('Failed to generate session token:', error);
            throw new Error('Unable to authenticate with Olexi server. Please try again.');
        }
    }

    // (No API key required on the client; server-side holds any credentials it needs.)

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
            <div id="olexi-toolbar" aria-label="Chat actions toolbar"></div>
        </div>
        <div class="olexi-welcome">
            <h3>Welcome to Olexi AI Extension</h3>
            <p>Use Olexi to search the AustLII database by entering your legal query.</p>            
        </div>
        <div id="olexi-messages"></div>
        <form id="olexi-input-form">
            <textarea id="olexi-input" placeholder="e.g., Recent HCA cases on unconscionable conduct [Press Ctrl+Enter shortcut to Search]" title="Press Ctrl+Enter to send" rows="2"></textarea>
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
    const toolbar = document.getElementById('olexi-toolbar');
    // No database filter in primary UX

    // Toolbar buttons (icon-only)
    const btnNew = createIconButton('🗘', 'Start a new chat');
    const btnCopyAll = createIconButton('📋', 'Copy entire chat');
    const btnSaveJson = createIconButton('💾', 'Save chat as JSON');
    const btnSavePdf = createIconButton('📄', 'Save chat as PDF');
    btnNew.id = 'olexi-btn-new-chat';
    btnCopyAll.id = 'olexi-btn-copy-all';
    btnSaveJson.id = 'olexi-btn-save-json';
    btnSavePdf.id = 'olexi-btn-save-pdf';
    toolbar.appendChild(btnNew);
    toolbar.appendChild(btnCopyAll);
    toolbar.appendChild(btnSaveJson);
    toolbar.appendChild(btnSavePdf);

    btnNew.addEventListener('click', () => {
        if (!confirm('Start a new chat? This will clear the current conversation.')) return;
        clearChat();
    });
    btnCopyAll.addEventListener('click', async () => {
        if (chatHistory.length === 0) return;
        const text = chatHistory.map(m => `${m.role === 'user' ? 'User' : 'Olexi'}: ${m.content}`).join('\n\n');
        await copyToClipboard(text);
        flashToolbar(btnCopyAll);
    });
    btnSaveJson.addEventListener('click', () => {
        if (chatHistory.length === 0) return;
        const payload = { meta: { exportedAt: new Date().toISOString(), page: location.href, title: document.title }, messages: chatHistory };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const fname = `olexi_chat_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
        triggerDownload(blob, fname);
        flashToolbar(btnSaveJson);
    });
    btnSavePdf.addEventListener('click', () => {
        if (chatHistory.length === 0) return;
        exportChatPdf(chatHistory);
        flashToolbar(btnSavePdf);
    });
    updateToolbarState();

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
            removeProcessingIndicator(); // clean up any stale processing banner
            await streamSession(userPrompt);
        } catch (error) {
            removeLoadingIndicator();
            removeProcessingIndicator();
            console.error('Olexi Error:', error);
            let msg = typeof error?.message === 'string' ? error.message : 'Something went wrong.';
            if (/AustLII is not accessible/i.test(msg)) msg = 'AustLII is not responding. Please try again later.';
            displayMessage(msg, 'ai');
        }
    });

    // Resolve host base URL (supports window.OLEXI_HOST_URL, local dev, then Cloud Run)
    let _resolvedHostBase = null;
    let _resolvingHostBase = null;
    async function resolveHostBase() {
        if (_resolvedHostBase) return _resolvedHostBase;
        if (_resolvingHostBase) return _resolvingHostBase;
        const candidates = [];
        const prodHost = 'https://olexi-extension-host-655512577217.australia-southeast1.run.app';
        const onAustlii = /austlii\.edu\.au$/i.test(location.hostname);
        const isLocalPage = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);

        // 1. Explicit override via global (e.g. injected by popup or page script)
        if (typeof window !== 'undefined' && window.OLEXI_HOST_URL) {
            candidates.push(String(window.OLEXI_HOST_URL).replace(/\/$/, ''));
        }

        // If we're actually on austlii.edu.au (normal user environment), try production FIRST to avoid waiting on localhost timeouts
        if (onAustlii) {
            candidates.push(prodHost);
        }

        // 2. Local dev candidates (only helpful for developers). We still include them for override cases.
        if (ALLOW_LOCAL_PROBES) {
            candidates.push('http://127.0.0.1:3000');
            candidates.push('http://localhost:3000');
            candidates.push('http://127.0.0.1:8080');
            candidates.push('http://localhost:8080');
        }

        // 3. If not already added (e.g. local dev context), ensure production host appears once at the end as fallback
        if (!candidates.includes(prodHost)) candidates.push(prodHost);
        _resolvingHostBase = (async () => {
            const errors = [];
            for (const base of candidates) {
                try {
                    const controller = new AbortController();
                    // Adaptive timeout: keep production generous (4000ms, cold starts) but make local probes shorter when on AustLII page.
                    const isLocalCandidate = /localhost|127\.0\.0\.1/.test(base);
                    const timeoutMs = isLocalCandidate && onAustlii ? 1200 : 4000;
                    const t = setTimeout(() => controller.abort(), timeoutMs);
                    const ping = await fetch(base + '/', {
                        method: 'GET',
                        headers: { 'Accept': 'application/json,*/*' },
                        mode: 'cors',
                        credentials: 'omit',
                        cache: 'no-store',
                        signal: controller.signal,
                    });
                    clearTimeout(t);
                    if (ping.ok) { _resolvedHostBase = base; return base; }
                    errors.push(`${base} -> HTTP ${ping.status}`);
                } catch (e) {
                    errors.push(`${base} -> ${e && e.name === 'AbortError' ? 'timeout' : (e.message || 'error')}`);
                }
            }
            // Provide richer diagnostics to aid setup
            console.warn('Olexi host resolution failed. Tried candidates:', errors);
            throw new Error('Olexi host is unreachable. Start the host (uvicorn on port 3000 or 8080) or set window.OLEXI_HOST_URL before page load. Open DevTools console for diagnostics.');
        })();
        try { return await _resolvingHostBase; } finally { _resolvingHostBase = null; }
    }

    // --- Streaming SSE over POST to /session/research ---
    async function streamSession(prompt) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);
        let shareUrl = null;
        try {
            const base = await resolveHostBase();
            const fingerprint = await generateInstallationFingerprint();
            const token = await getOrCreateSessionToken();
            let res;
            try {
                res = await fetch(base + '/session/research', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                    'X-Extension-Id': 'olexi-local',
                    'X-Extension-Fingerprint': fingerprint,
                    'X-Session-Token': token
                },
                mode: 'cors',
                credentials: 'omit',
                body: JSON.stringify({ prompt }),
                signal: controller.signal,
                });
            } catch (netErr) {
                const msg = (netErr && netErr.message) ? netErr.message : String(netErr);
                throw new Error(`Network error contacting Olexi host at ${base}: ${msg}`);
            }
            if (!res.ok || !res.body) {
                let detail = '';
                try { 
                    const errorData = await res.json();
                    detail = errorData.detail || '';
                } catch {
                    try { detail = await res.text(); } catch {}
                }
                
                // Handle token-related errors
                if (res.status === 401 && detail.includes('token')) {
                    // Clear stored token and try to get a new one
                    localStorage.removeItem('olexi-session-token');
                    sessionToken = null;
                    throw new Error('Session expired. Please try your request again.');
                }
                
                throw new Error(detail || res.statusText || `HTTP ${res.status}`);
            }
            const ctype = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
            if (!/text\/event-stream/i.test(ctype)) {
                throw new Error(`Unexpected response content-type: ${ctype || 'unknown'}`);
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
                            // Show the initial preview, then immediately show a processing spinner while AI prepares the summary
                            removeLoadingIndicator();
                            const items = Array.isArray(payload.items) ? payload.items : [];
                            const md = renderResultsMarkdown(items);
                            displayMessage(md, 'ai');
                            showProcessingIndicator();
                        } else if (event === 'answer') {
                            removeLoadingIndicator();
                            removeProcessingIndicator();
                            shareUrl = payload.url || null;
                            const md = typeof payload.markdown === 'string' ? payload.markdown : 'No answer.';
                            displayMessage(md, 'ai', shareUrl);
                        } else if (event === 'error') {
                            removeLoadingIndicator();
                            removeProcessingIndicator();
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
        return `Top Search Results:\n\n${items.join('\n')}${extra}`;
    }

    function escapeMd(s) {
        return String(s).replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&');
    }

    function displayMessage(text, sender, searchUrl = null) {
        const welcomeMsg = document.querySelector('.olexi-welcome');
        if (welcomeMsg && sender === 'user') welcomeMsg.style.display = 'none';
        // Persist in history
        chatHistory.push({ role: sender === 'user' ? 'user' : 'ai', content: text, ts: Date.now() });
        const el = document.createElement('div');
        el.classList.add('olexi-message', `${sender}-message`);
    const htmlText = mdToHtml(text);
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
        // Per-message copy
        const copyBtn = document.createElement('button');
        copyBtn.className = 'olexi-msg-copy';
        copyBtn.type = 'button';
        copyBtn.title = 'Copy response';
        copyBtn.textContent = '📋';
        copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await copyToClipboard(text);
            copyBtn.classList.add('copied');
            setTimeout(() => copyBtn.classList.remove('copied'), 600);
        });
        el.appendChild(copyBtn);
        messagesContainer.appendChild(el);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        updateToolbarState();
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
                removeProcessingIndicator();
                await streamSession(prompt);
            }
        } catch {
            // ignore non-URL or unsupported
        }
    });

    function showLoadingIndicator() {
        const el = document.createElement('div');
        el.id = 'olexi-loading';
        el.classList.add('olexi-message', 'ai-message');
        el.innerHTML = '\ud83d\udd0d Olexi AI is searching Australian legal databases...<br><small>This may take 30-60 seconds</small>';
        messagesContainer.appendChild(el);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function removeLoadingIndicator() {
        const el = document.getElementById('olexi-loading');
        if (el) el.remove();
    }

    function showProcessingIndicator() {
        // Avoid duplicates
        removeProcessingIndicator();
        const el = document.createElement('div');
        el.id = 'olexi-processing';
        el.classList.add('olexi-message', 'ai-message');
        el.innerHTML = '<span class="olexi-spinner" aria-hidden="true"></span> Olexi AI is processing the search results. Please wait...';
        messagesContainer.appendChild(el);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function removeProcessingIndicator() {
        const el = document.getElementById('olexi-processing');
        if (el) el.remove();
    }

    // --- Helpers ---
    function createIconButton(iconText, title) {
        const btn = document.createElement('button');
        btn.className = 'olexi-icon-btn';
        btn.type = 'button';
        btn.title = title;
        btn.textContent = iconText;
        return btn;
    }

    function clearChat() {
        chatHistory.splice(0, chatHistory.length);
        messagesContainer.innerHTML = '';
    removeLoadingIndicator();
    removeProcessingIndicator();
        const welcomeMsg = document.querySelector('.olexi-welcome');
        if (welcomeMsg) welcomeMsg.style.display = '';
        updateToolbarState();
    }

    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
    }

    function triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function exportChatPdf(history) {
        const w = window.open('', '_blank');
        if (!w) { alert('Popup blocked. Please allow popups to save PDF.'); return; }
        const style = `
            <style>
                body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 24px; }
                h1 { font-size: 18px; margin: 0 0 16px; }
                .meta { color: #475569; font-size: 12px; margin-bottom: 16px; }
                .msg { padding: 10px 12px; border-radius: 10px; margin: 10px 0; white-space: pre-wrap; }
                .user { background: #1D4ED8; color: white; }
                .ai { background: #f1f5f9; color: #0f172a; border-left: 3px solid #3B82F6; }
                a { color: #1D4ED8; text-decoration: underline; }
                @media print { .meta a { color: inherit; text-decoration: none; } }
            </style>`;
        const html = `<!doctype html><html><head><meta charset="utf-8">${style}</head><body>
            <h1>Olexi Chat Export</h1>
            <div class="meta">Exported: ${new Date().toLocaleString()}<br>Page: <a href="${location.href}">${location.href}</a></div>
            ${history.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${mdToHtml(m.content)}</div>`).join('')}
        </body></html>`;
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.onload = () => w.print();
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttr(s) {
        return String(s).replace(/"/g, '&quot;');
    }

    // Markdown to HTML (headings, lists, bold, links). Simple and safe for our content.
    function mdToHtml(md) {
        if (!md) return '';
        const rawLines = String(md).split(/\r?\n/);
        // Normalize lines by merging cases where a markdown link is split across lines:
        // [text]\n(url)  -> [text](url)
        // Also handle the fallback form: (text)\n[url] -> (text)[url]
        const lines = [];
        for (let i = 0; i < rawLines.length; i++) {
            let cur = rawLines[i];
            if (i + 1 < rawLines.length) {
                const next = rawLines[i + 1];
                const curTrimEnd = cur.replace(/\s+$/, '');
                const nextTrimStart = next.replace(/^\s+/, '');
                if (curTrimEnd.endsWith(']') && /^\(.*$/.test(nextTrimStart)) {
                    // Merge [text] + (url)
                    lines.push(curTrimEnd + nextTrimStart);
                    i++; // skip next
                    continue;
                }
                if (curTrimEnd.endsWith(')') && /^\[.*$/.test(nextTrimStart)) {
                    // Merge (text) + [url] for fallback form
                    lines.push(curTrimEnd + nextTrimStart);
                    i++;
                    continue;
                }
            }
            lines.push(cur);
        }
        let html = '';
        let inList = false;
        const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
        for (let raw of lines) {
            const line = raw;
            const trimmed = line.trim();
            const t = line.replace(/^\s+/, ''); // ignore leading spaces for block syntax
            if (t.startsWith('### ')) {
                closeList();
                html += `<h3>${mdInlineToHtml(t.slice(4))}</h3>`;
            } else if (t.startsWith('## ')) {
                closeList();
                html += `<h2>${mdInlineToHtml(t.slice(3))}</h2>`;
            } else if (t.startsWith('# ')) {
                closeList();
                html += `<h1>${mdInlineToHtml(t.slice(2))}</h1>`;
            } else if (/^[-*]\s+/.test(t)) {
                if (!inList) { html += '<ul>'; inList = true; }
                const item = t.replace(/^[-*]\s+/, '');
                html += `<li>${mdInlineToHtml(item)}</li>`;
            } else if (trimmed === '') {
                closeList();
                html += '<br>';
            } else {
                closeList();
                html += `<p>${mdInlineToHtml(line)}</p>`;
            }
        }
        closeList();
        return html;
    }

    function mdInlineToHtml(s) {
        if (!s) return '';
        const src = String(s);

        // Helpers
        function isEscaped(str, idx) {
            // returns true if character at idx is escaped by an odd number of backslashes immediately preceding
            let backslashes = 0; let k = idx - 1;
            while (k >= 0 && str[k] === '\\') { backslashes++; k--; }
            return (backslashes % 2) === 1;
        }
        function findNextUnescaped(str, ch, from) {
            for (let p = from; p < str.length; p++) {
                if (str[p] === ch && !isEscaped(str, p)) return p;
            }
            return -1;
        }
        function unescapeDisplay(str) {
            // Unescape for display only; do not affect parsing decisions
            return String(str).replace(/\\([\\\[\]\(\)\*_])/g, '$1');
        }
        function unescapeUrl(str) {
            // URLs may contain escaped parentheses; turn them back
            return String(str).replace(/\\([\(\)])/g, '$1');
        }

        let out = '';
        let i = 0;
    while (i < src.length) {
            const ch = src[i];
            if (ch === '[' && !isEscaped(src, i)) {
                // Find matching ']' allowing nested brackets in link text, respecting escapes
                let p = i + 1;
                let textDepth = 1;
                while (p < src.length && textDepth > 0) {
                    if (src[p] === '[' && !isEscaped(src, p)) textDepth++;
                    else if (src[p] === ']' && !isEscaped(src, p)) textDepth--;
                    p++;
                }
                if (textDepth === 0) {
                    const closeText = p - 1;
                    // allow optional whitespace before '('
                    let k = closeText + 1;
                    while (k < src.length && /\s/.test(src[k])) k++;
                    if (k < src.length && src[k] === '(' && !isEscaped(src, k)) {
                        // find matching ')' with depth, respecting escapes (support nested parentheses in URL)
                        let j = k + 1;
                        let depth = 1;
                        while (j < src.length && depth > 0) {
                            if (src[j] === '(' && !isEscaped(src, j)) depth++;
                            else if (src[j] === ')' && !isEscaped(src, j)) depth--;
                            j++;
                        }
                        if (depth === 0) {
                            const text = src.slice(i + 1, closeText);
                            const url = src.slice(k + 1, j - 1);
                            out += `<a href="${escapeAttr(unescapeUrl(url))}" target="_blank">${escapeHtml(unescapeDisplay(text))}</a>`;
                            i = j; // continue after ')'
                            continue;
                        }
                    }
                }
            }
            // Fallback: support non-standard (text)[url]
            if (ch === '(' && !isEscaped(src, i)) {
                // find matching ')' with depth, to support nested parentheses in text
                let j = i + 1;
                let depth = 1;
                while (j < src.length && depth > 0) {
                    if (src[j] === '(' && !isEscaped(src, j)) depth++;
                    else if (src[j] === ')' && !isEscaped(src, j)) depth--;
                    j++;
                }
                if (depth === 0) {
                    const text = src.slice(i + 1, j - 1);
                    let k = j; while (k < src.length && /\s/.test(src[k])) k++;
                    if (k < src.length && src[k] === '[' && !isEscaped(src, k)) {
                        // find matching ']' with depth to support nested brackets in URL
                        let q = k + 1;
                        let bdepth = 1;
                        while (q < src.length && bdepth > 0) {
                            if (src[q] === '[' && !isEscaped(src, q)) bdepth++;
                            else if (src[q] === ']' && !isEscaped(src, q)) bdepth--;
                            q++;
                        }
                        if (bdepth === 0) {
                            const closeUrl = q - 1;
                            const url = src.slice(k + 1, closeUrl);
                            out += `<a href="${escapeAttr(unescapeUrl(url))}" target="_blank">${escapeHtml(unescapeDisplay(text))}</a>`;
                            i = closeUrl + 1;
                            continue;
                        }
                    }
                }
            }
            // No (valid) link at this position; accumulate plain text until next potential '['
            let next = findNextUnescaped(src, '[', i + 1);
            if (next === -1) next = src.length;
            let segment = src.slice(i, next);
            // Unescape display sequences now (so \[ renders as [ in output, etc.)
            segment = unescapeDisplay(segment);
            segment = escapeHtml(segment);
            // Bold **text** or __text__
            segment = segment.replace(/(\*\*|__)([\s\S]+?)\1/g, '<strong>$2</strong>');
            // Italic *text* or _text_
            segment = segment.replace(/(\*|_)([^*_][\s\S]*?)\1/g, '<em>$2</em>');
            out += segment;
            i = next;
        }
        return out;
    }

    function flashToolbar(btn) {
        btn.classList.add('olexi-flash');
        setTimeout(() => btn.classList.remove('olexi-flash'), 300);
    }

    function updateToolbarState() {
        const disabled = chatHistory.length === 0;
        [btnCopyAll, btnSaveJson, btnSavePdf].forEach(b => b.disabled = disabled);
    }
})();