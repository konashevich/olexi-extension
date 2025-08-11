// content.js

(function() {
    // Ensure the script runs only once
    if (document.getElementById('olexi-chat-container')) {
        return;
    }

    const TOOLS_BASE = 'http://127.0.0.1:3000/api/tools';

    // Retrieve API key from extension storage; prompt once if missing
    async function getApiKey() {
        return await new Promise((resolve, reject) => {
            try {
                chrome.storage?.local.get(['olexi_api_key'], (items) => {
                    const existing = items?.olexi_api_key;
                    if (existing && typeof existing === 'string' && existing.trim()) {
                        resolve(existing.trim());
                        return;
                    }
                    const entered = window.prompt('Enter your Olexi API key to authorize the extension:');
                    if (!entered || !entered.trim()) {
                        reject(new Error('Missing API key'));
                        return;
                    }
                    const key = entered.trim();
                    try {
                        chrome.storage?.local.set({ olexi_api_key: key }, () => resolve(key));
                    } catch (_) {
                        resolve(key);
                    }
                });
            } catch (e) {
                // Fallback to simple prompt/localStorage if chrome.storage is unavailable
                try {
                    let key = localStorage.getItem('olexi_api_key');
                    if (!key) {
                        const entered = window.prompt('Enter your Olexi API key to authorize the extension:');
                        if (!entered || !entered.trim()) {
                            reject(new Error('Missing API key'));
                            return;
                        }
                        key = entered.trim();
                        localStorage.setItem('olexi_api_key', key);
                    }
                    resolve(key);
                } catch (err) {
                    reject(err);
                }
            }
        });
    }

    // --- 1. Create the Chat UI ---
    const chatContainer = document.createElement('div');
    chatContainer.id = 'olexi-chat-container';
    chatContainer.innerHTML = `
        <div id="olexi-header">
            <div class="logo">
                <div>
                    <div>Olexi AI</div>
                    <div class="subtitle">Legal Research Assistant</div>
                </div>
            </div>
        </div>
        <div class="olexi-welcome">
            <h3>Welcome to Olexi AI</h3>
            <p>Ask questions about Australian law and I'll search through legal databases to provide you with relevant cases, legislation, and analysis.</p>
            <p><small>Tip: Press Ctrl+Enter to send your question.</small></p>
        </div>
        <div id="olexi-messages"></div>
        <form id="olexi-input-form">
            <textarea id="olexi-input" placeholder="Ask a legal question about Australian law… (Ctrl+Enter to send)" title="Press Ctrl+Enter to send" rows="2"></textarea>
            <button id="olexi-send-btn" type="submit">Send Question</button>
        </form>
    `;
    
    // Create toggle button
    const toggleButton = document.createElement('button');
    toggleButton.id = 'olexi-toggle-btn';
    toggleButton.textContent = '\u25c0 Hide';
    toggleButton.setAttribute('title', 'Toggle Olexi AI Panel');
    
    document.body.appendChild(chatContainer);
    document.body.appendChild(toggleButton);

    // --- 2. Get references to the UI elements ---
    const messagesContainer = document.getElementById('olexi-messages');
    const inputForm = document.getElementById('olexi-input-form');
    const inputField = document.getElementById('olexi-input');
    const toggleBtn = document.getElementById('olexi-toggle-btn');

    // --- 3. Handle Toggle Functionality ---
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

    // Handle keyboard shortcuts
    inputField.addEventListener('keydown', function(e) {
        // Submit on Ctrl/Cmd + Enter
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            inputForm.dispatchEvent(new Event('submit'));
        }
        // Toggle panel on Ctrl/Cmd + Shift + O
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'O') {
            e.preventDefault();
            toggleBtn.click();
        }
    });

    // Global keyboard shortcut for toggling
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'O') {
            e.preventDefault();
            toggleBtn.click();
        }
    });

    // --- 4. Handle Form Submission ---
    inputForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const userPrompt = inputField.value.trim();

        if (!userPrompt) return;

        displayMessage(userPrompt, 'user');
        inputField.value = '';
        inputField.style.height = 'auto'; // Reset textarea height
        showLoadingIndicator();

        try {
            // New MCP-like orchestration via bridge endpoints
            const plan = await postJson(`${TOOLS_BASE}/plan_search`, { prompt: userPrompt });
            const results = await postJson(`${TOOLS_BASE}/search_austlii`, { query: plan.query, databases: plan.databases });
            const summary = await postJson(`${TOOLS_BASE}/summarize_results`, { prompt: userPrompt, results });
            const built = await postJson(`${TOOLS_BASE}/build_search_url`, { query: plan.query, databases: plan.databases });

            removeLoadingIndicator();
            displayMessage(summary.markdown, 'ai', built.url);
        } catch (error) {
            removeLoadingIndicator();
            console.error('Olexi AI Error:', error);
            
            // Distinguish the cause clearly for the user: AI vs AustLII vs Network
            let errorMessage = '';
            const msg = typeof error?.message === 'string' ? error.message : '';
            const detail = typeof error?.detail === 'string' ? error.detail : '';
            const status = typeof error?.status === 'number' ? error.status : undefined;

            const combined = `${detail} ${msg}`;

            if (combined.match(/AustLII is not accessible/i)) {
                // AustLII outage or block
                errorMessage = 'AustLII is not responding. Source data is temporarily unavailable. Please try again later.';
                // Optionally surface health info if available
                try {
                    const health = await getJson('http://127.0.0.1:3000/austlii/health');
                    if (health && typeof health.status !== 'undefined') {
                        errorMessage += `\nDetails: status ${health.status}${health.cached ? ' (cached)' : ''}${health.error ? `, ${health.error}` : ''}.`;
                    }
                } catch (_) { /* ignore health fetch errors */ }
            } else if (
                combined.match(/AI is not accessible/i) ||
                combined.match(/AI planning failed/i) ||
                combined.match(/AI summarization failed/i)
            ) {
                // AI service or key issue
                errorMessage = 'AI service unavailable. Please configure GOOGLE_API_KEY on the server and retry.';
            } else if (msg.includes('Failed to fetch')) {
                errorMessage = 'Cannot reach the Olexi server. Ensure it is running on http://127.0.0.1:3000.';
            } else if (msg.includes('The operation was aborted') || msg.includes('aborted')) {
                errorMessage = 'Request was aborted (timeout). Please try again.';
            } else if (typeof status === 'number') {
                errorMessage = `Request failed (HTTP ${status}). ${detail || 'Please try again.'}`;
            } else {
                errorMessage = detail || msg || 'Something went wrong. Please try again.';
            }

            // Prefix a clear cause label
            if (/AustLII is not responding/i.test(errorMessage)) {
                errorMessage = 'Cause: AustLII unavailable\n' + errorMessage;
            } else if (/AI service unavailable/i.test(errorMessage) || /AI is not accessible/i.test(errorMessage)) {
                errorMessage = 'Cause: AI unavailable\n' + errorMessage;
            } else if (/Cannot reach the Olexi server/i.test(errorMessage)) {
                errorMessage = 'Cause: Network/server\n' + errorMessage;
            }

            displayMessage(errorMessage, 'ai');
        }
    });

    // --- 5. API Communication ---
    // Removed legacy /api/olexi-chat fallback. This tool is AI-only by design.

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
                // Attempt to parse FastAPI error object {detail: "..."}
                let detail = '';
                try {
                    const data = await res.clone().json();
                    if (data && typeof data.detail === 'string') detail = data.detail;
                } catch (_) {
                    try {
                        const text = await res.text();
                        detail = text || '';
                    } catch (_) { /* ignore */ }
                }
                const err = new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
                // Attach structured fields for downstream handling
                err.detail = detail;
                err.status = res.status;
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
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        try {
            const res = await fetch(url, { method: 'GET', signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            return await res.json();
        } catch (e) {
            clearTimeout(timeoutId);
            throw e;
        }
    }

    // --- 6. Display & Utility Functions ---
    function displayMessage(text, sender, searchUrl = null) {
        // Clear the welcome message when first message is sent
        const welcomeMsg = document.querySelector('.olexi-welcome');
        if (welcomeMsg && sender === 'user') {
            welcomeMsg.style.display = 'none';
        }

        const messageElement = document.createElement('div');
        messageElement.classList.add('olexi-message', `${sender}-message`);
        
        // Basic Markdown to HTML for links
        let htmlText = text.replace(/\n/g, '<br>'); // Convert newlines
        htmlText = htmlText.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>'); // Convert [text](url)
        
        messageElement.innerHTML = htmlText;

        // Add the "View full results" link if it exists
        if (sender === 'ai' && searchUrl) {
            const linkElement = document.createElement('a');
            linkElement.href = searchUrl;
            linkElement.textContent = '\ud83d\udcc4 View full search results on AustLII';
            linkElement.target = '_blank';
            linkElement.style.display = 'block';
            linkElement.style.marginTop = '12px';
            linkElement.style.fontWeight = 'bold';
            linkElement.style.padding = '8px 12px';
            linkElement.style.backgroundColor = '#f1f5f9';
            linkElement.style.borderRadius = '8px';
            linkElement.style.textDecoration = 'none';
            linkElement.style.color = '#1e293b';
            linkElement.style.fontSize = '13px';
            messageElement.appendChild(linkElement);
        }

        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight; // Auto-scroll to bottom
    }

    function showLoadingIndicator() {
        const loadingElement = document.createElement('div');
        loadingElement.id = 'olexi-loading';
        loadingElement.classList.add('olexi-message', 'ai-message');
        loadingElement.innerHTML = '\ud83d\udd0d Searching Australian legal databases...<br><small>This may take 30-60 seconds for comprehensive results</small>';
        messagesContainer.appendChild(loadingElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function removeLoadingIndicator() {
        const loadingElement = document.getElementById('olexi-loading');
        if (loadingElement) {
            loadingElement.remove();
        }
    }

})();