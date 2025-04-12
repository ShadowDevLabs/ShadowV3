import { marked } from "https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js";

const textarea = document.querySelector('.input-container textarea');
const sendBtn = document.querySelector('.send-btn');
const messagesContainer = document.querySelector('.messages');

const uValue = 'user';
const aiValue = 'assistant';
const chatHistoryLimit = 6;

let chatHistory = [];

const getCsrfToken = async () => {
    try {
        const response = await fetch('/csrf-token');
        const data = await response.json();
        return data.csrfToken;
    } catch (error) {
        console.error('Error Fetching the CSRF TOKEN: ', error);
        return null;
    }
};

const csrfToken = await getCsrfToken();

if (!csrfToken) {
    console.error("Failed to Retrevie  CSRF TOKEN");
}

sendBtn.addEventListener('click', async () => {
    await sendMsg();
});

textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        if (!(event.shiftKey || event.ctrlKey || event.altKey)) {
            event.preventDefault();
            sendMsg();
        }
    }
});

async function sendMsg() {
    const message = textarea.value.trim();
    if (!message) return;

    addMsg(message, uValue);
    chatHistory.push({ role: uValue, content: message });

    if (chatHistory.length > chatHistoryLimit) chatHistory.shift();
    textarea.value = '';

    const payload = { messages: chatHistory };

    const loadingMsg = addMsg('', aiValue, true);

    try {
        const response = await fetch('/ask', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'CSRF-Token': csrfToken
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        const aiMsg = data.error ? 'Error: ' + data.error : data;

        loadingMsg.innerHTML = marked(aiMsg);
        loadingMsg.classList.remove('loading');
        loadingMsg.classList.add('show');
        loadingMsg.addEventListener("click", () => {
            navigator.clipboard.writeText(aiMsg);
        });
        chatHistory.push({ role: aiValue, content: aiMsg });

        if (chatHistory.length > chatHistoryLimit) chatHistory.shift();
    } catch {
        loadingMsg.innerHTML = 'Failed to reach Shadow Assistant. Try again.';
        loadingMsg.classList.remove('loading');
        loadingMsg.classList.add('show');
    }
}

function addMsg(content, role, isLoading = false) {
    const msgElement = document.createElement('div');
    msgElement.classList.add('message', role);

    if (isLoading) {
        msgElement.classList.add('loading');
        msgElement.innerHTML = `
            <div class="spinner"></div>
            ${content}
        `;
    } else {
        msgElement.innerHTML = marked(content); 
    }

    messagesContainer.appendChild(msgElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    setTimeout(() => {
        msgElement.classList.add('show');
    }, 10);

    return msgElement;
}

addMsg("**Hello, how may I help you?**", aiValue);
