// content.js (Redesigned: agent-led, MCP-host style; no server-side AI calls)

(function() {
    if (document.getElementById('olexi-chat-container')) return; // run once

    const TOOLS_BASE = 'http://127.0.0.1:3000/api/tools';

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
            <p><small>Tip: Press Ctrl+Enter to send. Click the filter to adjust databases.</small></p>
        </div>
        <div id="olexi-dbbar" style="padding:8px 12px; border-bottom:1px solid #e2e8f0; background:#fff; display:flex; gap:8px; align-items:center;">
            <button id="olexi-db-filter" type="button" title="Choose databases" style="padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc; cursor:pointer;">Databases</button>
            <div id="olexi-db-summary" style="font-size:12px; color:#334155; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Loading databases…</div>
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
    const dbFilterBtn = document.getElementById('olexi-db-filter');
    const dbSummary = document.getElementById('olexi-db-summary');

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

    // --- Databases state ---
    let ALL_DATABASES = [];
    let selectedDbCodes = new Set();

    function summarizeDbSelection() {
        if (!ALL_DATABASES.length) { dbSummary.textContent = 'Loading databases…'; return; }
        if (!selectedDbCodes.size) { dbSummary.textContent = 'No databases selected (will auto-select based on prompt)'; return; }
        const names = ALL_DATABASES.filter(d => selectedDbCodes.has(d.code)).map(d => d.name);
        dbSummary.textContent = `${names.slice(0,3).join(', ')}${names.length>3 ? ` +${names.length-3} more` : ''}`;
    }

    function chooseDatabasesFromPrompt(prompt) {
        // Minimal heuristics: detect HCA, NSW, VIC, QLD, WA, SA, ACT, NT
        const p = (prompt||'').toLowerCase();
        const picks = [];
        const find = code => ALL_DATABASES.find(d => d.code === code);
        if (/\b(hca|high court)\b/.test(p)) { if (find('au/cases/cth/HCA')) picks.push('au/cases/cth/HCA'); }
        if (/\bnsw\b/.test(p)) { if (find('au/cases/nsw')) picks.push('au/cases/nsw'); }
        if (/\bvic(toria|)\b/.test(p)) { if (find('au/cases/vic')) picks.push('au/cases/vic'); }
        if (/\bqld\b/.test(p)) { if (find('au/cases/qld')) picks.push('au/cases/qld'); }
        if (/\bwa\b/.test(p)) { if (find('au/cases/wa')) picks.push('au/cases/wa'); }
        if (/\bsa\b/.test(p)) { if (find('au/cases/sa')) picks.push('au/cases/sa'); }
        if (/\bact\b/.test(p)) { if (find('au/cases/act/ACTSC')) picks.push('au/cases/act/ACTSC'); }
        if (/\bnt\b/.test(p)) { if (find('au/cases/nt/NTSC')) picks.push('au/cases/nt/NTSC'); }
        // Default federal anchors
        if (!picks.length) {
            if (find('au/cases/cth/HCA')) picks.push('au/cases/cth/HCA');
            if (find('au/cases/cth/FCA')) picks.push('au/cases/cth/FCA');
        }
        return Array.from(new Set(picks));
    }

    async function loadDatabases() {
        try {
            const list = await getJson(`${TOOLS_BASE}/databases`);
            if (Array.isArray(list)) ALL_DATABASES = list; else ALL_DATABASES = [];
            summarizeDbSelection();
        } catch (e) {
            ALL_DATABASES = [];
            dbSummary.textContent = 'Failed to load databases';
        }
    }
    loadDatabases();

    // Simple selector modal
    dbFilterBtn.addEventListener('click', () => {
        if (!ALL_DATABASES.length) return;
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.top = '0'; modal.style.left = '0'; modal.style.right = '0'; modal.style.bottom = '0';
        modal.style.background = 'rgba(0,0,0,0.3)';
        modal.style.zIndex = '10002';
        const pane = document.createElement('div');
        pane.style.position = 'absolute'; pane.style.top = '10%'; pane.style.left = '50%'; pane.style.transform = 'translateX(-50%)';
        pane.style.width = '520px'; pane.style.maxHeight = '70%'; pane.style.overflow = 'auto';
        pane.style.background = '#fff'; pane.style.border = '1px solid #e2e8f0'; pane.style.borderRadius = '12px'; pane.style.padding = '12px';
        const title = document.createElement('div'); title.textContent = 'Select databases'; title.style.fontWeight = 'bold'; title.style.marginBottom = '8px';
        const listEl = document.createElement('div');
        listEl.style.display = 'grid'; listEl.style.gridTemplateColumns = '1fr 1fr'; listEl.style.gap = '6px 12px';
        ALL_DATABASES.forEach(db => {
            const item = document.createElement('label'); item.style.fontSize = '12px'; item.style.display = 'flex'; item.style.gap = '6px'; item.style.alignItems = 'start';
            const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = selectedDbCodes.has(db.code);
            cb.addEventListener('change', () => { if (cb.checked) selectedDbCodes.add(db.code); else selectedDbCodes.delete(db.code); });
            item.appendChild(cb);
            const span = document.createElement('span'); span.textContent = `${db.name}`; span.title = db.description || '';
            item.appendChild(span);
            listEl.appendChild(item);
        });
        const actions = document.createElement('div'); actions.style.marginTop = '10px'; actions.style.display = 'flex'; actions.style.gap = '8px'; actions.style.justifyContent = 'flex-end';
        const applyBtn = document.createElement('button'); applyBtn.textContent = 'Apply'; applyBtn.style.padding = '6px 10px'; applyBtn.style.border = '1px solid #cbd5e1'; applyBtn.style.borderRadius = '6px'; applyBtn.style.background = '#f8fafc';
        applyBtn.addEventListener('click', () => { summarizeDbSelection(); document.body.removeChild(modal); });
        const cancelBtn = document.createElement('button'); cancelBtn.textContent = 'Cancel'; cancelBtn.style.padding = '6px 10px'; cancelBtn.style.border = '1px solid #cbd5e1'; cancelBtn.style.borderRadius = '6px'; cancelBtn.style.background = '#fff';
        cancelBtn.addEventListener('click', () => { document.body.removeChild(modal); });
        actions.appendChild(cancelBtn); actions.appendChild(applyBtn);
        pane.appendChild(title); pane.appendChild(listEl); pane.appendChild(actions);
        modal.appendChild(pane);
        modal.addEventListener('click', (e) => { if (e.target === modal) document.body.removeChild(modal); });
        document.body.appendChild(modal);
    });

    // --- Submit flow: host-orchestrated, MCP-only tools ---
    inputForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const userPrompt = inputField.value.trim();
        if (!userPrompt) return;
        displayMessage(userPrompt, 'user');
        inputField.value = ''; inputField.style.height = 'auto';
        showLoadingIndicator();
        try {
            // Determine databases: user-selected or heuristic from prompt
            let dbCodes = Array.from(selectedDbCodes);
            if (!dbCodes.length) dbCodes = chooseDatabasesFromPrompt(userPrompt);
            if (!dbCodes.length) throw new Error('No databases selected and none inferred from prompt. Use the Databases button to select.');

            // Treat prompt as boolean query (host agent can be improved later)
            const query = userPrompt;

            const results = await postJson(`${TOOLS_BASE}/search_austlii`, { query, databases: dbCodes });
            const built = await postJson(`${TOOLS_BASE}/build_search_url`, { query, databases: dbCodes });

            removeLoadingIndicator();
            const md = renderResultsMarkdown(results);
            displayMessage(md, 'ai', built.url);
        } catch (error) {
            removeLoadingIndicator();
            console.error('Olexi Error:', error);
            let msg = typeof error?.message === 'string' ? error.message : 'Something went wrong.';
            if (/AustLII is not accessible/i.test(msg)) msg = 'AustLII is not responding. Please try again later.';
            displayMessage(msg, 'ai');
        }
    });

    // --- HTTP helpers ---
    async function postJson(url, body) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);
        try {
            const apiKey = await getApiKey();
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, 'X-Extension-Id': 'olexi-local' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!res.ok) {
                let detail = '';
                try { const data = await res.clone().json(); if (data && typeof data.detail === 'string') detail = data.detail; } catch {}
                try { if (!detail) detail = await res.text(); } catch {}
                const err = new Error(detail || res.statusText);
                err.status = res.status; // @ts-ignore
                throw err;
            }
            return await res.json();
        } catch (e) {
            clearTimeout(timeoutId);
            throw e;
        }
    }

    async function getJson(url) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        try {
            const apiKey = await getApiKey();
            const res = await fetch(url, { method: 'GET', signal: controller.signal, headers: { 'X-API-Key': apiKey, 'X-Extension-Id': 'olexi-local' } });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) { clearTimeout(timeoutId); throw e; }
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