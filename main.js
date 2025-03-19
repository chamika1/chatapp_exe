const { app, BrowserWindow, ipcMain, net, Menu } = require('electron')
const path = require('path')
const Groq = require('groq-sdk')
const fs = require('fs')
const FormData = require('form-data')
const axios = require('axios')

const groq = new Groq({
  apiKey: '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'
})

// Add conversation history
let conversationHistory = [
  {
    role: "system",
    content: "You are a helpful AI assistant. Be concise but informative in your responses."
  }
];

// Add this at the top with other variables
let lastImageContext = null;

// Add this variable at the top with other state variables
let webSearchEnabled = false;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 1000,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  // Remove default menu bar
  Menu.setApplicationMenu(null)

  mainWindow.loadFile('index.html')
}

app.whenReady().then(createWindow)

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

function encodeImage(imagePath) {
  const image = fs.readFileSync(imagePath)
  return image.toString('base64')
}

// Add a new handler for updating loading state
ipcMain.handle('set-loading', (event, isLoading) => {
    mainWindow.webContents.send('loading-state-changed', isLoading);
});

// Modify the analyze-image handler to show loading state
ipcMain.handle('analyze-image', async (event, input) => {
    try {
        event.sender.send('loading-state-changed', true);
        let imageUrl;
        if (typeof input === 'string' && input.startsWith('http')) {
            imageUrl = input;
        } else {
            const base64Image = encodeImage(input);
            imageUrl = `data:image/jpeg;base64,${base64Image}`;
        }
        
        // Create the image message
        const imageMessage = {
            role: "user",
            content: [
                {
                    type: "text",
                    text: "What is in this image?"
                },
                {
                    type: "image_url",
                    image_url: {
                        url: imageUrl
                    }
                }
            ]
        };

        // Store image context for follow-up questions
        lastImageContext = imageMessage;

        // Don't include system message for vision model
        const chat_completion = await groq.chat.completions.create({
            messages: [imageMessage], // Only include the image message
            model: "llama-3.2-11b-vision-preview",
        });

        const aiResponse = chat_completion.choices[0].message.content;
        
        // Add text-only versions to conversation history
        conversationHistory.push({ 
            role: "user", 
            content: "I shared an image for analysis." 
        });
        conversationHistory.push({ 
            role: "assistant", 
            content: aiResponse 
        });

        return aiResponse;
    } catch (error) {
        console.error('Error analyzing image:', error);
        return 'Sorry, there was an error analyzing the image.';
    } finally {
        event.sender.send('loading-state-changed', false);
    }
});

// DuckDuckGo search function without API key
async function searchDuckDuckGo(query) {
    try {
        const encodedQuery = encodeURIComponent(query);
        const response = await axios.get(`https://html.duckduckgo.com/html/?q=${encodedQuery}`);
        
        // Parse the HTML response to extract search results
        const results = response.data.match(/<a class="result__url".*?>(.*?)<\/a>.*?<a class="result__snippet".*?>(.*?)<\/a>/gs);
        
        if (!results) return [];

        return results.slice(0, 3).map(result => {
            const [_, url, snippet] = result.match(/<a class="result__url".*?>(.*?)<\/a>.*?<a class="result__snippet".*?>(.*?)<\/a>/s);
            return {
                url: url.trim(),
                snippet: snippet.replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim()
            };
        });
    } catch (error) {
        console.error('DuckDuckGo search error:', error);
        return [];
    }
}

// Update the ask-ai handler to format responses with markdown
ipcMain.handle('ask-ai', async (event, message) => {
    try {
        let searchResults = [];
        if (webSearchEnabled) {
            searchResults = await searchDuckDuckGo(message);
            console.log('Search results:', searchResults);
        }

        let prompt = message;
        if (searchResults.length > 0) {
            prompt = `
                Question: ${message}
                
                Web Search Results:
                ${searchResults.map((result, index) => 
                    `[${index + 1}] ${result.snippet}
                     Source: ${result.url}`
                ).join('\n\n')}
                
                Please provide a comprehensive answer based on these search results. Format your response in markdown. Include source references [1], [2], etc. when using information from the search results.
            `;
        }

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: "You are an AI assistant that provides accurate, up-to-date information. Format responses in markdown. Use code blocks with language specification when showing code. Always cite sources when using web search results."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            max_tokens: 1024,
        });

        return completion.choices[0].message.content;
    } catch (error) {
        console.error('Error:', error);
        return '**Error:** Sorry, there was an error processing your request.';
    }
});

// Add handler for toggling web search
ipcMain.handle('toggle-web-search', (event, enabled) => {
    webSearchEnabled = enabled;
    return webSearchEnabled;
});

// Add this helper function to detect follow-up questions
function isFollowUpQuestion(message) {
    const followUpIndicators = [
        'what about', 'tell me more', 'how about', 'what else', 
        'can you describe', 'where is', 'when was', 'who is',
        'why is', 'how many', 'what is', 'describe', 'explain'
    ];
    
    message = message.toLowerCase();
    return followUpIndicators.some(indicator => message.includes(indicator));
}

// Add handler to clear image context
ipcMain.handle('clear-chat', () => {
    conversationHistory = [conversationHistory[0]];
    lastImageContext = null;
    return true;
});

// Modify the generateImage handler to include in chat memory
ipcMain.handle('generate-image', async (event, prompt) => {
    try {
        // Add image generation request to conversation history
        conversationHistory.push({
            role: "user",
            content: `Generate an image: ${prompt}`
        });

        // Add the generated image response to conversation history
        conversationHistory.push({
            role: "assistant",
            content: `Generated image for prompt: "${prompt}"`
        });

        // Keep conversation history at a reasonable length
        if (conversationHistory.length > 11) {
            conversationHistory = [
                conversationHistory[0],
                ...conversationHistory.slice(-10)
            ];
        }

        return true;
    } catch (error) {
        console.error('Error generating image:', error);
        return false;
    }
});

// Update the transcribeAudio function to use Electron's net module
async function transcribeAudio(audioBuffer) {
    const formData = new FormData();
    formData.append('file', audioBuffer, {
        filename: 'audio.m4a',
        contentType: 'audio/m4a'
    });
    formData.append('model', 'whisper-large-v3');
    formData.append('response_format', 'json');
    formData.append('language', 'en');
    formData.append('temperature', '0.0');

    return new Promise((resolve, reject) => {
        const request = net.request({
            method: 'POST',
            url: 'https://api.groq.com/openai/v1/audio/translations',
            headers: {
                'Authorization': `Bearer ${groq.apiKey}`,
                ...formData.getHeaders()
            }
        });

        request.on('response', (response) => {
            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });
            response.on('end', () => {
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP error! status: ${response.statusCode}`));
                    return;
                }
                try {
                    const jsonResponse = JSON.parse(data);
                    resolve(jsonResponse.text);
                } catch (error) {
                    reject(error);
                }
            });
        });

        request.on('error', (error) => {
            reject(error);
        });

        request.write(formData.getBuffer());
        request.end();
    });
}

// Add handler for audio transcription
ipcMain.handle('transcribe-audio', async (event, audioPath) => {
    try {
        const audioBuffer = fs.readFileSync(audioPath);
        const transcription = await transcribeAudio(audioBuffer);
        
        // Add transcription to conversation history
        conversationHistory.push({
            role: "user",
            content: `Audio transcription: ${transcription}`
        });

        return transcription;
    } catch (error) {
        console.error('Error transcribing audio:', error);
        return 'Sorry, there was an error transcribing the audio.';
    }
});