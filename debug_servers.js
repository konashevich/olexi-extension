// Debug script to compare local vs remote server responses
// Run this in browser console to compare outputs

async function compareServers() {
    const testQuery = {
        prompt: "copyright law Australia",
        maxResults: 3,
        databases: ["nsw"]
    };
    
    const servers = [
        { name: "Local", url: "http://localhost:3000" },
        { name: "Remote", url: "https://olexi-extension-host-655512577217.australia-southeast1.run.app" }
    ];
    
    for (const server of servers) {
        console.log(`\n=== Testing ${server.name} Server ===`);
        try {
            const response = await fetch(server.url + '/session/research', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                    'X-API-Key': 'test',
                    'X-Extension-Id': 'olexi-debug'
                },
                body: JSON.stringify(testQuery)
            });
            
            if (!response.ok) {
                console.error(`${server.name}: HTTP ${response.status}`);
                continue;
            }
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                fullResponse += decoder.decode(value, { stream: true });
            }
            
            console.log(`${server.name} Response:`, fullResponse);
            
            // Extract just the answer markdown
            const answerMatch = fullResponse.match(/event: answer\ndata: ({.*})/);
            if (answerMatch) {
                const answerData = JSON.parse(answerMatch[1]);
                console.log(`${server.name} Markdown:`, answerData.markdown);
            }
            
        } catch (error) {
            console.error(`${server.name} Error:`, error);
        }
    }
}

// Run the comparison
compareServers();
