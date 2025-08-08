// content.js

(function() {
    // Ensure the script runs only once
    if (document.getElementById('olexi-chat-container')) {
        return;
    }

    const API_URL = 'http://127.0.0.1:3000/api/olexi-chat';

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
        </div>
        <div id="olexi-messages"></div>
        <form id="olexi-input-form">
            <textarea id="olexi-input" placeholder="Ask a legal question about Australian law..." rows="2"></textarea>
            <button id="olexi-send-btn" type="submit">Send Question</button>
        </form>
    `;
    
    // Create toggle button
    const toggleButton = document.createElement('button');
    toggleButton.id = 'olexi-toggle-btn';
    toggleButton.textContent = '◀ Hide';
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
            toggleBtn.textContent = '▶ Show Olexi';
        } else {
            document.body.classList.remove('olexi-collapsed');
            chatContainer.classList.remove('collapsed');
            toggleBtn.classList.remove('collapsed');
            toggleBtn.textContent = '◀ Hide';
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
            const response = await callOlexiAPI(userPrompt);
            removeLoadingIndicator();
            displayMessage(response.ai_response, 'ai', response.search_results_url);
        } catch (error) {
            removeLoadingIndicator();
            console.error('Olexi AI Error:', error);
            
            // Show more specific error messages
            let errorMessage = 'Sorry, I encountered an error. Please try again.';
            if (error.message.includes('timed out')) {
                errorMessage = 'Request timed out after 60 seconds. The query may be too complex or the server is busy. Please try again.';
            } else if (error.message.includes('Failed to fetch')) {
                errorMessage = 'Could not connect to Olexi server. Please check if the server is running on port 3000.';
            } else if (error.message.includes('500')) {
                errorMessage = 'Server error occurred. Please check the server logs for details.';
            } else if (error.message) {
                errorMessage = `Error: ${error.message}`;
            }
            
            displayMessage(errorMessage, 'ai');
        }
    });

    // --- 5. API Communication ---
    async function callOlexiAPI(prompt) {
        console.log('Making API request to:', API_URL);
        console.log('Request payload:', { prompt, context_url: window.location.href });
        
        // Add timeout to the fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
        
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: prompt,
                    context_url: window.location.href // Send current page URL as context
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            console.log('Response status:', response.status);
            console.log('Response ok:', response.ok);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Error response body:', errorText);
                throw new Error(`API request failed with status ${response.status}: ${errorText}`);
            }
            
            const jsonResponse = await response.json();
            console.log('Success response:', jsonResponse);
            return jsonResponse;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Request timed out after 60 seconds');
            }
            throw error;
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
            linkElement.textContent = '📄 View full search results on AustLII';
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
        loadingElement.innerHTML = '🔍 Searching Australian legal databases...<br><small>This may take 30-60 seconds for comprehensive results</small>';
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