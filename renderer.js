const { ipcRenderer } = require('electron');
const MarkdownIt = require('markdown-it');
const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: true
});

const userInput = document.getElementById('userInput');
const sendButton = document.getElementById('sendButton');
const imageButton = document.getElementById('imageButton');
const chatContainer = document.getElementById('chatContainer');
const voiceButton = document.getElementById('voiceButton');
let isListening = false;
const speechRecognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
const speechSynthesis = window.speechSynthesis;
let isSpeaking = false;
let currentUtterance = null;

const clearButton = document.createElement('button');
clearButton.className = 'icon-button';
clearButton.title = 'Clear Chat';
clearButton.innerHTML = '<i class="fas fa-trash"></i>';

function addMessage(content, isUser = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
    
    const timestamp = document.createElement('div');
    timestamp.className = 'message-timestamp';
    timestamp.textContent = new Date().toLocaleTimeString();
    
    if (!isUser && typeof content === 'string') {
        // Render markdown for AI responses
        const textContent = document.createElement('div');
        textContent.className = 'markdown-content';
        textContent.innerHTML = md.render(content);
        
        // Add syntax highlighting to code blocks
        textContent.querySelectorAll('pre code').forEach((block) => {
            block.classList.add('hljs');
        });
        
        const controls = document.createElement('div');
        controls.className = 'message-controls';
        
        const speakButton = document.createElement('button');
        speakButton.className = 'control-button';
        speakButton.innerHTML = '<i class="fas fa-volume-up"></i>';
        speakButton.title = 'Speak Text';
        speakButton.onclick = () => speakText(textContent.textContent, speakButton);
        
        controls.appendChild(speakButton);
        messageDiv.appendChild(textContent);
        messageDiv.appendChild(controls);
    } else {
        messageDiv.innerHTML = content;
    }

    messageDiv.appendChild(timestamp);
    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

async function handleSend() {
    const message = userInput.value.trim();
    if (!message) return;

    addMessage(message, true);
    userInput.value = '';

    const response = await ipcRenderer.invoke('ask-ai', message);
    addMessage(response);
}

async function generateImage() {
    const prompt = userInput.value.trim();
    if (!prompt) return;

    // Add user's image generation request to chat
    addMessage(`Generate image: ${prompt}`, true);

    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1420&nologo=true`;
    
    // Create wrapper div for image and download button
    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'image-wrapper';
    
    // Add the image
    const imageHtml = `<img src="${imageUrl}" alt="Generated Image">`;
    imageWrapper.innerHTML = imageHtml;
    
    // Add download button
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'download-button';
    downloadBtn.innerHTML = 'Download Image';
    downloadBtn.onclick = () => downloadImage(imageUrl, `ai-image-${Date.now()}.jpg`);
    imageWrapper.appendChild(downloadBtn);
    
    // Add the wrapper to the chat
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ai-message';
    messageDiv.appendChild(imageWrapper);
    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    
    // Add to chat memory
    await ipcRenderer.invoke('generate-image', prompt);
    
    userInput.value = '';
}

async function downloadImage(url, filename) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
        console.error('Error downloading image:', error);
    }
}

function setupSpeechRecognition() {
    try {
        speechRecognition.continuous = false;
        speechRecognition.interimResults = true;
        speechRecognition.lang = 'en-US';

        speechRecognition.onstart = () => {
            updateVoiceButton(true);
            showToast('Listening...');
        };

        speechRecognition.onresult = (event) => {
            const transcript = Array.from(event.results)
                .map(result => result[0].transcript)
                .join('');
            
            userInput.value = transcript;
            
            if (event.results[0].isFinal) {
                setTimeout(() => handleSend(), 500);
            }
        };

        speechRecognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            let errorMessage;
            
            switch (event.error) {
                case 'network':
                    errorMessage = 'Network error. Please check your internet connection.';
                    break;
                case 'not-allowed':
                    errorMessage = 'Microphone access denied. Please allow microphone access.';
                    break;
                case 'no-speech':
                    errorMessage = 'No speech detected. Please try again.';
                    break;
                default:
                    errorMessage = `Speech recognition error: ${event.error}`;
            }
            
            showError(errorMessage);
            stopListening();
        };

        speechRecognition.onend = () => {
            stopListening();
        };

    } catch (error) {
        console.error('Speech recognition setup error:', error);
        voiceButton.style.display = 'none'; // Hide the voice button if speech recognition is not available
    }
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'message error-message';
    errorDiv.textContent = message;
    chatContainer.appendChild(errorDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    
    // Remove error message after 3 seconds
    setTimeout(() => {
        errorDiv.remove();
    }, 3000);
}

function updateVoiceButton(isListening) {
    voiceButton.classList.toggle('listening', isListening);
    voiceButton.innerHTML = isListening ?
        '<i class="fas fa-stop"></i>' :
        '<i class="fas fa-microphone"></i>';
    voiceButton.title = isListening ? 'Stop Listening' : 'Start Voice Input';
}

function startListening() {
    try {
        if (!navigator.onLine) {
            showError('No internet connection. Voice input requires internet access.');
            return;
        }
        
        speechRecognition.start();
        isListening = true;
        updateVoiceButton(true);
    } catch (error) {
        console.error('Speech recognition error:', error);
        showError('Could not start speech recognition. Please try again.');
        stopListening();
    }
}

function stopListening() {
    try {
        speechRecognition.stop();
    } catch (error) {
        console.error('Error stopping speech recognition:', error);
    }
    isListening = false;
    updateVoiceButton(false);
}

function speakText(text, button) {
    if (isSpeaking) {
        speechSynthesis.cancel();
        isSpeaking = false;
        updateSpeakButton(button, false);
        return;
    }

    currentUtterance = new SpeechSynthesisUtterance(text);
    currentUtterance.rate = 1.0;
    currentUtterance.pitch = 1.0;
    currentUtterance.volume = 1.0;

    currentUtterance.onend = () => {
        isSpeaking = false;
        updateSpeakButton(button, false);
    };

    currentUtterance.onerror = () => {
        isSpeaking = false;
        updateSpeakButton(button, false);
    };

    speechSynthesis.speak(currentUtterance);
    isSpeaking = true;
    updateSpeakButton(button, true);
}

function updateSpeakButton(button, isPlaying) {
    button.innerHTML = isPlaying ? 
        '<i class="fas fa-stop"></i>' : 
        '<i class="fas fa-volume-up"></i>';
    button.title = isPlaying ? 'Stop Speaking' : 'Speak Text';
}

// Add event listeners
setupSpeechRecognition();
voiceButton.addEventListener('click', startListening);

sendButton.addEventListener('click', handleSend);
imageButton.addEventListener('click', generateImage);

userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
});

// Add file type validation
function validateImageFile(file) {
    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!supportedTypes.includes(file.type)) {
        showError('Unsupported file type. Please upload a JPEG, PNG, WEBP, or GIF image.');
        return false;
    }
    return true;
}

// Modify handleImageUpload
async function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file || !validateImageFile(file)) return;

    // Show loading message
    const loadingMessage = document.createElement('div');
    loadingMessage.className = 'message ai-message loading';
    loadingMessage.innerHTML = 'Analyzing image... <div class="loading-dots"><span>.</span><span>.</span><span>.</span></div>';
    chatContainer.appendChild(loadingMessage);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    try {
        // Display the uploaded image
        const imageUrl = URL.createObjectURL(file);
        const imageWrapper = document.createElement('div');
        imageWrapper.className = 'image-wrapper uploaded-image';
        imageWrapper.innerHTML = `<img src="${imageUrl}" alt="Uploaded Image">`;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message user-message';
        messageDiv.appendChild(imageWrapper);
        chatContainer.appendChild(messageDiv);

        // Get analysis from Groq
        const analysis = await ipcRenderer.invoke('analyze-image', file.path);
        
        // Remove loading message
        loadingMessage.remove();
        
        // Display the analysis
        addMessage(analysis);
    } catch (error) {
        console.error('Error handling image:', error);
        loadingMessage.remove();
        addMessage('Sorry, there was an error analyzing the image.');
    }
}

function addImageUploadButton() {
    const inputContainer = document.querySelector('.input-container');
    
    const uploadButton = document.createElement('button');
    uploadButton.className = 'icon-button';
    uploadButton.title = 'Upload Image';
    uploadButton.innerHTML = '<i class="fas fa-upload"></i>';
    
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', handleImageUpload);
    
    uploadButton.addEventListener('click', () => fileInput.click());
    
    inputContainer.insertBefore(fileInput, inputContainer.firstChild);
    inputContainer.insertBefore(uploadButton, inputContainer.firstChild);
}

function addAudioUploadButton() {
    const inputContainer = document.querySelector('.input-container');
    
    const audioButton = document.createElement('button');
    audioButton.className = 'icon-button';
    audioButton.title = 'Upload Audio';
    audioButton.innerHTML = '<i class="fas fa-microphone-alt"></i>';
    
    const audioInput = document.createElement('input');
    audioInput.type = 'file';
    audioInput.accept = 'audio/*';
    audioInput.style.display = 'none';
    audioInput.addEventListener('change', handleAudioUpload);
    
    audioButton.addEventListener('click', () => audioInput.click());
    
    inputContainer.insertBefore(audioInput, inputContainer.firstChild);
    inputContainer.insertBefore(audioButton, inputContainer.firstChild);
}

async function handleAudioUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Show loading message
    const loadingMessage = document.createElement('div');
    loadingMessage.className = 'message ai-message loading';
    loadingMessage.innerHTML = 'Transcribing audio... <div class="loading-dots"><span>.</span><span>.</span><span>.</span></div>';
    chatContainer.appendChild(loadingMessage);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    try {
        // Display audio file info
        const audioWrapper = document.createElement('div');
        audioWrapper.className = 'audio-wrapper';
        audioWrapper.innerHTML = `
            <div class="audio-info">
                <i class="fas fa-file-audio"></i>
                <span>${file.name}</span>
            </div>
        `;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message user-message';
        messageDiv.appendChild(audioWrapper);
        chatContainer.appendChild(messageDiv);

        // Get transcription from Groq
        const transcription = await ipcRenderer.invoke('transcribe-audio', file.path);
        
        // Remove loading message
        loadingMessage.remove();
        
        // Display the transcription
        addMessage(`Transcription: ${transcription}`);
    } catch (error) {
        console.error('Error handling audio:', error);
        loadingMessage.remove();
        addMessage('Sorry, there was an error transcribing the audio.');
    }
}

function addWebSearchToggle() {
    const inputContainer = document.querySelector('.input-container');
    
    const webSearchButton = document.createElement('button');
    webSearchButton.className = 'icon-button';
    webSearchButton.title = 'Toggle Web Search';
    webSearchButton.innerHTML = '<i class="fas fa-globe"></i>';
    webSearchButton.dataset.enabled = 'false';
    
    webSearchButton.addEventListener('click', async () => {
        const newState = webSearchButton.dataset.enabled === 'false';
        const result = await ipcRenderer.invoke('toggle-web-search', newState);
        
        webSearchButton.dataset.enabled = result.toString();
        webSearchButton.classList.toggle('active', result);
        
        showToast(`Web search ${result ? 'enabled' : 'disabled'}`, 'info');
    });
    
    inputContainer.insertBefore(webSearchButton, inputContainer.firstChild);
}

function addControlButtons() {
    const inputContainer = document.querySelector('.input-container');
    
    // Add clear button
    clearButton.addEventListener('click', clearChat);
    inputContainer.insertBefore(clearButton, inputContainer.firstChild);
    
    // Add web search toggle
    addWebSearchToggle();
    
    // Add audio upload button
    addAudioUploadButton();
    
    // Add image upload button
    addImageUploadButton();
}

async function clearChat() {
    // Show confirmation dialog
    if (confirm('Are you sure you want to clear the chat history?')) {
        await ipcRenderer.invoke('clear-chat');
        chatContainer.innerHTML = '';
        addMessage('Chat history cleared. How can I help you?');
    }
}

// Add a toast notification function
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function setupCharacterCounter() {
    const maxChars = 4000;
    const counterDiv = document.createElement('div');
    counterDiv.className = 'char-counter';
    
    userInput.addEventListener('input', () => {
        const remaining = maxChars - userInput.value.length;
        counterDiv.textContent = `${remaining} characters remaining`;
        counterDiv.style.color = remaining < 100 ? '#ff4444' : '#666';
    });
    
    document.querySelector('.input-container').appendChild(counterDiv);
}

// Add keyboard shortcuts
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + Enter to send
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            handleSend();
        }
        // Esc to clear input
        if (e.key === 'Escape') {
            userInput.value = '';
        }
        // Ctrl/Cmd + L to clear chat
        if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
            clearChat();
        }
    });
}

// Add drag and drop support
function setupDragAndDrop() {
    const dropZone = document.querySelector('.chat-container');
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drop-zone', 'active');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drop-zone', 'active');
    });
    
    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('drop-zone', 'active');
        
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            await handleImageUpload({ target: { files: [file] } });
        }
    });
}

addControlButtons();