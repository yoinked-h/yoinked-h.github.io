// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('aiappthing/sw.js')
            .then(reg => console.log('Service Worker registered'))
            .catch(err => console.log('Service Worker registration failed:', err));
    });
}

// Storage Manager
const Storage = {
    get(key, defaultValue = null) {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : defaultValue;
    },
    set(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    },
    remove(key) {
        localStorage.removeItem(key);
    }
};

// App State
const DEFAULT_GLOBAL_SETTINGS = {
    apiKey: '',
    theme: 'system',
    model: 'gemini-1.5-flash',
    temperature: 0.6,
    maxOutputTokens: 1024
};

let chats = Storage.get('chats', []);
let currentChatId = Storage.get('currentChatId', null);
let globalSettings = Storage.get('globalSettings', null) || {};
globalSettings = { ...DEFAULT_GLOBAL_SETTINGS, ...globalSettings };
Storage.set('globalSettings', globalSettings);

let currentMessageElement = null;
let currentChatItemElement = null;
let pendingAttachments = [];

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    
    // Create default chat if none exists
    if (chats.length === 0) {
        createNewChat();
    } else {
        loadChat(currentChatId || chats[0].id);
    }
    
    renderChatList();
    updateAttachmentPreview();
    updateSendButtonState();
});

// DOM Elements
const sideMenu = document.getElementById('sideMenu');
const menuOverlay = document.getElementById('menuOverlay');
const chatContainer = document.getElementById('chatContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const addBtn = document.getElementById('addBtn');
const menuBtn = document.getElementById('menuBtn');
const closeMenuBtn = document.getElementById('closeMenuBtn');
const settingsBtn = document.getElementById('settingsBtn');
const newChatBtn = document.getElementById('newChatBtn');
const globalSettingsBtn = document.getElementById('globalSettingsBtn');
const appTitle = document.getElementById('appTitle');
const chatList = document.getElementById('chatList');
const contextMenu = document.getElementById('contextMenu');
const chatContextMenu = document.getElementById('chatContextMenu');
const settingsModal = document.getElementById('settingsModal');
const globalSettingsModal = document.getElementById('globalSettingsModal');
const fileInput = document.getElementById('fileInput');
const attachmentPreview = document.getElementById('attachmentPreview');
// Theme Management
function initializeTheme() {
    applyTheme(globalSettings.theme);
}

function applyTheme(theme) {
    if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.body.dataset.theme = prefersDark ? 'dark' : 'light';
    } else {
        document.body.dataset.theme = theme;
    }
}

// Watch for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (globalSettings.theme === 'system') {
        applyTheme('system');
    }
});

// Menu Functions
menuBtn.addEventListener('click', () => {
    sideMenu.classList.add('open');
    menuOverlay.classList.add('visible');
});

closeMenuBtn.addEventListener('click', closeMenu);
menuOverlay.addEventListener('click', closeMenu);

function closeMenu() {
    sideMenu.classList.remove('open');
    menuOverlay.classList.remove('visible');
}

// Chat Management
function createNewChat() {
    const chat = {
        id: Date.now().toString(),
        name: 'Untitled',
        messages: [],
        settings: {
            userName: 'User',
            aiName: 'Assistant',
            systemInstructions: 'You are a helpful assistant.'
        },
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    
    chats.unshift(chat);
    Storage.set('chats', chats);
    loadChat(chat.id);
    renderChatList();
    closeMenu();
}

newChatBtn.addEventListener('click', createNewChat);

function loadChat(chatId) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    
    currentChatId = chatId;
    Storage.set('currentChatId', chatId);
    
    // Update title
    appTitle.textContent = chat.name;

    let timestampsUpdated = false;
    const timestampBase = Date.now();
    chat.messages.forEach((msg, index) => {
        if (typeof msg.timestamp !== 'number') {
            msg.timestamp = timestampBase + index;
            timestampsUpdated = true;
        }
    });
    if (timestampsUpdated) {
        updateChat({ messages: chat.messages });
    }
    
    // Clear and load messages
    chatContainer.innerHTML = '';
    resetPendingAttachments();
    if (messageInput) {
        messageInput.value = '';
        messageInput.style.height = 'auto';
    }
    updateSendButtonState();
    
    if (chat.messages.length === 0) {
        showWelcomeMessage();
    } else {
        chat.messages.forEach(msg => {
            addMessageToDOM(msg, false);
        });
    }
    
    renderChatList();
    scrollToBottom();
}

function getCurrentChat() {
    return chats.find(c => c.id === currentChatId);
}

function updateChat(updates) {
    const chat = getCurrentChat();
    if (!chat) return;
    
    Object.assign(chat, updates);
    chat.updatedAt = Date.now();
    Storage.set('chats', chats);
}

function deleteChat(chatId) {
    const index = chats.findIndex(c => c.id === chatId);
    if (index === -1) return;
    
    chats.splice(index, 1);
    Storage.set('chats', chats);
    
    if (chatId === currentChatId) {
        if (chats.length === 0) {
            createNewChat();
        } else {
            loadChat(chats[0].id);
        }
    }
    
    renderChatList();
}

// Render Chat List
function renderChatList() {
    chatList.innerHTML = '';
    
    chats.forEach(chat => {
        const item = document.createElement('div');
        item.className = 'chat-item';
        if (chat.id === currentChatId) {
            item.classList.add('active');
        }
        
        const lastMessage = chat.messages[chat.messages.length - 1];
        let fullPreview = '';

        if (lastMessage) {
            const textPreview = composeMessageContent(lastMessage.text);

            if (textPreview) {
                fullPreview = textPreview;
            } else if (Array.isArray(lastMessage.attachments) && lastMessage.attachments.length > 0) {
                const firstAttachment = lastMessage.attachments[0] || {};
                const attachmentCount = lastMessage.attachments.length;
                const descriptor = attachmentCount > 1
                    ? `${attachmentCount} attachments`
                    : (firstAttachment.name || 'Attachment');
                const typeDescriptor = (firstAttachment.mimeType || '').startsWith('image/') ? 'Image' : 'Attachment';
                fullPreview = `${typeDescriptor}: ${descriptor}`;
            }
        }

        const preview = fullPreview ? fullPreview.substring(0, 50) : 'No messages yet';
        
        item.innerHTML = `
            <div class="chat-item-content">
                <div class="chat-item-title">${chat.name}</div>
                <div class="chat-item-preview">${preview}</div>
            </div>
            <button class="chat-item-more">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="5" r="1"></circle>
                    <circle cx="12" cy="12" r="1"></circle>
                    <circle cx="12" cy="19" r="1"></circle>
                </svg>
            </button>
        `;
        
        const content = item.querySelector('.chat-item-content');
        content.addEventListener('click', () => {
            loadChat(chat.id);
            closeMenu();
        });
        
        const moreBtn = item.querySelector('.chat-item-more');
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showChatContextMenu(e, chat, item);
        });
        
        chatList.appendChild(item);
    });
}

// Chat Context Menu
function showChatContextMenu(e, chat, itemElement) {
    e.preventDefault();
    e.stopPropagation();
    
    currentChatItemElement = itemElement;
    
    const rect = itemElement.getBoundingClientRect();
    chatContextMenu.style.left = `${rect.right - 160}px`;
    chatContextMenu.style.top = `${rect.top}px`;
    chatContextMenu.classList.remove('hidden');
    
    // Store chat id for actions
    chatContextMenu.dataset.chatId = chat.id;
}

// Chat Context Menu Actions
document.querySelectorAll('#chatContextMenu .context-menu-item').forEach(item => {
    item.addEventListener('click', () => {
        const action = item.dataset.action;
        const chatId = chatContextMenu.dataset.chatId;
        handleChatContextAction(action, chatId);
        chatContextMenu.classList.add('hidden');
    });
});

function handleChatContextAction(action, chatId) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    
    switch(action) {
        case 'rename':
            const newName = prompt('Enter new chat name:', chat.name);
            if (newName && newName.trim()) {
                chat.name = newName.trim();
                chat.updatedAt = Date.now();
                Storage.set('chats', chats);
                if (chatId === currentChatId) {
                    appTitle.textContent = chat.name;
                }
                renderChatList();
            }
            break;
            
        case 'settings':
            openChatSettings(chat);
            break;
            
        case 'delete-chat':
            if (confirm(`Delete "${chat.name}"?`)) {
                deleteChat(chatId);
            }
            break;
    }
}

// Settings Modal
settingsBtn.addEventListener('click', () => {
    const chat = getCurrentChat();
    if (chat) {
        openChatSettings(chat);
    }
});

function openChatSettings(chat) {
    document.getElementById('chatName').value = chat.name;
    document.getElementById('userName').value = chat.settings.userName;
    document.getElementById('aiName').value = chat.settings.aiName;
    document.getElementById('systemInstructions').value = chat.settings.systemInstructions;
    
    settingsModal.classList.remove('hidden');
    settingsModal.dataset.chatId = chat.id;
}

document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

document.getElementById('cancelSettingsBtn').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

document.getElementById('settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const chatId = settingsModal.dataset.chatId;
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    
    chat.name = document.getElementById('chatName').value.trim() || 'Untitled';
    chat.settings.userName = document.getElementById('userName').value.trim() || 'User';
    chat.settings.aiName = document.getElementById('aiName').value.trim() || 'Assistant';
    chat.settings.systemInstructions = document.getElementById('systemInstructions').value.trim();
    chat.updatedAt = Date.now();
    
    Storage.set('chats', chats);
    
    if (chatId === currentChatId) {
        appTitle.textContent = chat.name;
    }
    
    renderChatList();
    settingsModal.classList.add('hidden');
});

// Global Settings Modal
globalSettingsBtn.addEventListener('click', () => {
    document.getElementById('apiKey').value = globalSettings.apiKey;
    document.getElementById('theme').value = globalSettings.theme;
    document.getElementById('model').value = globalSettings.model;
    document.getElementById('temperature').value = String(globalSettings.temperature ?? DEFAULT_GLOBAL_SETTINGS.temperature);
    document.getElementById('maxTokens').value = String(globalSettings.maxOutputTokens ?? DEFAULT_GLOBAL_SETTINGS.maxOutputTokens);
    globalSettingsModal.classList.remove('hidden');
    closeMenu();
});

document.getElementById('closeGlobalSettingsBtn').addEventListener('click', () => {
    globalSettingsModal.classList.add('hidden');
});

document.getElementById('cancelGlobalSettingsBtn').addEventListener('click', () => {
    globalSettingsModal.classList.add('hidden');
});

document.getElementById('globalSettingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    
    globalSettings.apiKey = document.getElementById('apiKey').value.trim();
    globalSettings.theme = document.getElementById('theme').value;
    globalSettings.model = document.getElementById('model').value;
    const temperatureValue = parseFloat(document.getElementById('temperature').value);
    const maxTokensValue = parseInt(document.getElementById('maxTokens').value, 10);
    const normalizedTemperature = Number.isFinite(temperatureValue) ? Math.min(1, Math.max(0, temperatureValue)) : DEFAULT_GLOBAL_SETTINGS.temperature;
    const normalizedMaxTokens = Number.isFinite(maxTokensValue) ? Math.min(8192, Math.max(1, maxTokensValue)) : DEFAULT_GLOBAL_SETTINGS.maxOutputTokens;
    globalSettings.temperature = normalizedTemperature;
    globalSettings.maxOutputTokens = normalizedMaxTokens;
    
    Storage.set('globalSettings', globalSettings);
    applyTheme(globalSettings.theme);
    
    globalSettingsModal.classList.add('hidden');
});

// Auto-resize textarea
messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    updateSendButtonState();
});

// Send message on Enter (Shift+Enter for new line)
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Send button click
sendBtn.addEventListener('click', sendMessage);

// Add button (attachment placeholder)
addBtn.addEventListener('click', () => {
    if (fileInput) {
        fileInput.click();
    }
});

if (fileInput) {
    fileInput.addEventListener('change', handleFileSelection);
}

if (attachmentPreview) {
    attachmentPreview.addEventListener('click', handleAttachmentPreviewClick);
}

// Send Message Function
async function sendMessage() {
    const message = messageInput.value.trim();
    const attachmentsToSend = pendingAttachments.map(att => ({ ...att }));

    if (!message && attachmentsToSend.length === 0) {
        return;
    }
    
    const chat = getCurrentChat();
    if (!chat) return;
    
    // Clear input
    messageInput.value = '';
    messageInput.style.height = 'auto';
    resetPendingAttachments();
    
    // Remove welcome message if exists
    const welcomeMsg = document.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }
    
    // Add user message
    addMessage({ text: message, sender: 'user', attachments: attachmentsToSend });
    
    // Show loading indicator
    const loadingIndicator = document.getElementById('loadingIndicator');
    loadingIndicator.classList.remove('hidden');
    chatContainer.appendChild(loadingIndicator);
    scrollToBottom();
    
    // Fetch AI response from Gemini
    try {
        const response = await CallGeminiApi(chat);
        
        // Remove loading indicator
        loadingIndicator.classList.add('hidden');
        
        // Add AI response
        addMessage({ text: response, sender: 'ai' });
        
        // Update chat name if first message
        if (chat.messages.length === 2 && chat.name === 'Untitled') {
            const titleSource = message;
            chat.name = titleSource.substring(0, 30) + (titleSource.length > 30 ? '...' : '');
            appTitle.textContent = chat.name;
            renderChatList();
        }
        
        updateChat({ messages: chat.messages });
    } catch (error) {
        loadingIndicator.classList.add('hidden');
        addMessage({ text: 'Sorry, something went wrong. Please try again.', sender: 'ai' });
    }
}

// Add Message to Chat
function addMessage({ text = '', sender, attachments = [] }) {
    const chat = getCurrentChat();
    if (!chat) return;

    const sanitizedAttachments = Array.isArray(attachments)
        ? attachments.filter(att => att && att.data).map(att => ({
            name: att.name || '',
            mimeType: att.mimeType || 'application/octet-stream',
            data: att.data,
            size: typeof att.size === 'number' ? att.size : undefined
        }))
        : [];

    const messageRecord = { text, sender, timestamp: Date.now() };

    if (sanitizedAttachments.length > 0) {
        messageRecord.attachments = sanitizedAttachments;
    }

    chat.messages.push(messageRecord);
    addMessageToDOM(messageRecord, true);
    updateChat({ messages: chat.messages });
}

function addMessageToDOM(message, animate = true) {
    if (!message) return;

    const sender = message.sender || 'ai';
    const text = (message.text || '').toString();
    const timestamp = typeof message.timestamp === 'number' ? message.timestamp : Date.now();
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    if (!animate) {
        messageDiv.style.animation = 'none';
    }
    messageDiv.dataset.timestamp = String(timestamp);
    
    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message-bubble';
    bubbleDiv.dataset.sender = sender;
    bubbleDiv.dataset.text = text;
    bubbleDiv.dataset.timestamp = String(timestamp);
    bubbleDiv.textContent = '';

        // Clear existing content
        bubbleDiv.textContent = '';
        // Render Markdown content using marked.js
        if (text) {
            const wrapper = document.createElement('div');
            wrapper.className = 'message-text';
            wrapper.innerHTML = marked.parse(text);
            bubbleDiv.appendChild(wrapper);
        }

    if (attachments.length > 0) {
        const attachmentsContainer = document.createElement('div');
        attachmentsContainer.className = 'message-attachments';
        attachments.forEach(attachment => {
            const attachmentElement = createMessageAttachmentElement(attachment);
            if (attachmentElement) {
                attachmentsContainer.appendChild(attachmentElement);
            }
        });

        if (attachmentsContainer.childElementCount > 0) {
            bubbleDiv.appendChild(attachmentsContainer);
        }
    }
        
    // Long press for context menu (mobile)
    let pressTimer;
    bubbleDiv.addEventListener('touchstart', (e) => {
        pressTimer = setTimeout(() => {
            showContextMenu(e, bubbleDiv);
        }, 500);
    });
    
    bubbleDiv.addEventListener('touchend', () => {
        clearTimeout(pressTimer);
    });
    
    bubbleDiv.addEventListener('touchmove', () => {
        clearTimeout(pressTimer);
    });
    
    // Right click for context menu (desktop)
    bubbleDiv.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, bubbleDiv);
    });
    
    messageDiv.appendChild(bubbleDiv);
    chatContainer.appendChild(messageDiv);
    
    if (animate) {
        scrollToBottom();
    }
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}


function createMessageAttachmentElement(attachment) {
    if (!attachment || !attachment.data) {
        return null;
    }

    const container = document.createElement('div');
    container.className = 'message-attachment-item';

    const info = document.createElement('div');
    info.className = 'message-attachment-info';
    const nameText = attachment.name ? attachment.name : 'Attachment';
    const sizeText = typeof attachment.size === 'number' && attachment.size > 0
        ? ` (${formatFileSize(attachment.size)})`
        : '';
    info.textContent = `${nameText}${sizeText}`;

    const mimeType = (attachment.mimeType || 'application/octet-stream').toLowerCase();
    const dataUrl = `data:${mimeType};base64,${attachment.data}`;

    let mediaElement = null;

    if (mimeType.startsWith('image/')) {
        mediaElement = document.createElement('img');
        mediaElement.src = dataUrl;
        mediaElement.alt = nameText;
    } else if (mimeType.startsWith('video/')) {
        mediaElement = document.createElement('video');
        mediaElement.controls = true;
        mediaElement.src = dataUrl;
    } else if (mimeType.startsWith('audio/')) {
        mediaElement = document.createElement('audio');
        mediaElement.controls = true;
        mediaElement.src = dataUrl;
    } else {
        mediaElement = document.createElement('a');
        mediaElement.href = dataUrl;
        mediaElement.download = attachment.name || 'attachment';
        mediaElement.textContent = 'Download attachment';
        mediaElement.rel = 'noopener';
    }

    container.appendChild(info);
    container.appendChild(mediaElement);

    return container;
}

function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

async function handleFileSelection(event) {
    const input = event.target;
    const files = Array.from(input?.files || []);

    if (files.length === 0) {
        return;
    }

    const attachments = [];

    for (const file of files) {
        try {
            const dataUrl = await readFileAsDataURL(file);
            if (typeof dataUrl !== 'string') {
                continue;
            }

            const [meta, base64Data] = dataUrl.split(',', 2);
            if (!base64Data) {
                continue;
            }

            const mimeMatch = /^data:(.*?);base64$/i.exec(meta || '');
            const resolvedMimeType = file.type || (mimeMatch ? mimeMatch[1] : '') || 'application/octet-stream';

            attachments.push({
                name: file.name,
                mimeType: resolvedMimeType,
                data: base64Data,
                size: file.size
            });
        } catch (error) {
            console.error('Failed to process attachment', error);
        }
    }

    if (attachments.length > 0) {
        pendingAttachments = pendingAttachments.concat(attachments);
        updateAttachmentPreview();
        updateSendButtonState();
    }

    if (fileInput) {
        fileInput.value = '';
    }
}

function handleAttachmentPreviewClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    const button = target.closest('[data-action="remove-attachment"]');
    if (button instanceof HTMLElement) {
        const index = Number(button.dataset.index);
        if (Number.isInteger(index)) {
            removePendingAttachment(index);
        }
    }
}

function removePendingAttachment(index) {
    if (index < 0 || index >= pendingAttachments.length) {
        return;
    }

    pendingAttachments.splice(index, 1);
    updateAttachmentPreview();
    updateSendButtonState();
}

function resetPendingAttachments() {
    pendingAttachments = [];
    updateAttachmentPreview();
    if (fileInput) {
        fileInput.value = '';
    }
    updateSendButtonState();
}

function updateAttachmentPreview() {
    if (!attachmentPreview) {
        return;
    }

    attachmentPreview.innerHTML = '';

    if (pendingAttachments.length === 0) {
        attachmentPreview.classList.add('hidden');
        return;
    }

    pendingAttachments.forEach((attachment, index) => {
        const item = document.createElement('div');
        item.className = 'attachment-item';

        const label = document.createElement('span');
        const sizeText = typeof attachment.size === 'number' && attachment.size > 0
            ? ` (${formatFileSize(attachment.size)})`
            : '';
        label.textContent = `${attachment.name || `Attachment ${index + 1}`}${sizeText}`;

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.dataset.action = 'remove-attachment';
        removeButton.dataset.index = String(index);
        removeButton.setAttribute('aria-label', 'Remove attachment');
        removeButton.textContent = 'Remove';

        item.appendChild(label);
        item.appendChild(removeButton);
        attachmentPreview.appendChild(item);
    });

    attachmentPreview.classList.remove('hidden');
}

function updateSendButtonState() {
    if (!sendBtn || !messageInput) {
        return;
    }

    const hasMessage = messageInput.value.trim().length > 0;
    const hasAttachments = pendingAttachments.length > 0;
    sendBtn.disabled = !hasMessage && !hasAttachments;
}


function composeMessageContent(text) {
    const trimmedText = (text || '').trim();
    const segments = [];
    if (trimmedText) {
        segments.push(trimmedText);
    }
    return segments.join("\n");
}

function buildMessageParts(message) {
    const parts = [];
    const textContent = composeMessageContent(message?.text);
    if (textContent) {
        parts.push({ text: textContent });
    }

    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    attachments.forEach(attachment => {
        if (!attachment || !attachment.data) {
            return;
        }

        const mimeType = (attachment.mimeType || 'application/octet-stream').trim();
        parts.push({
            inline_data: {
                mime_type: mimeType || 'application/octet-stream',
                data: attachment.data
            }
        });
    });

    return parts;
}

// Show Context Menu
function showContextMenu(e, bubbleElement) {
    e.preventDefault();
    
    currentMessageElement = bubbleElement.closest('.message');
    
    // Position context menu
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove('hidden');
    
    // Adjust if menu goes off screen
    setTimeout(() => {
        const rect = contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            contextMenu.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            contextMenu.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
    }, 0);
}

// Hide context menus when clicking outside
document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target) && !e.target.classList.contains('message-bubble')) {
        contextMenu.classList.add('hidden');
    }
    if (!chatContextMenu.contains(e.target) && !e.target.closest('.chat-item-more')) {
        chatContextMenu.classList.add('hidden');
    }
});

// Context Menu Actions
document.querySelectorAll('#contextMenu .context-menu-item').forEach(item => {
    item.addEventListener('click', () => {
        const action = item.dataset.action;
        handleContextAction(action);
        contextMenu.classList.add('hidden');
    });
});

// Handle Context Menu Actions
function handleContextAction(action) {
    if (!currentMessageElement) return;
    
    const chat = getCurrentChat();
    if (!chat) return;
    
    const bubble = currentMessageElement.querySelector('.message-bubble');
    const text = bubble.dataset.text;
    const sender = bubble.dataset.sender;
    const timestampValue = Number(bubble.dataset.timestamp || currentMessageElement.dataset.timestamp || 0);
    const messageRecordIndex = chat.messages.findIndex(msg => {
        if (sender && msg.sender !== sender) return false;
        return typeof msg.timestamp === 'number' && msg.timestamp === timestampValue;
    });
    const messageRecord = messageRecordIndex !== -1 ? chat.messages[messageRecordIndex] : null;
    
    // Find message index
    const messageIndex = Array.from(chatContainer.children).indexOf(currentMessageElement);
    
    switch(action) {
        case 'edit':
            if (messageRecord && Array.isArray(messageRecord.attachments)) {
                pendingAttachments = messageRecord.attachments.map(att => ({ ...att }));
            } else {
                pendingAttachments = [];
            }
            updateAttachmentPreview();
            messageInput.value = text;
            messageInput.focus();
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
            updateSendButtonState();
            break;
            
        case 'delete':
            currentMessageElement.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => {
                currentMessageElement.remove();
                
                // Remove from chat history
                let removed = false;
                if (messageRecordIndex !== -1) {
                    chat.messages.splice(messageRecordIndex, 1);
                    removed = true;
                } else {
                    const fallbackIndex = chat.messages.findIndex((msg, idx) => msg.text === text && msg.sender === sender && idx === messageIndex);
                    if (fallbackIndex !== -1) {
                        chat.messages.splice(fallbackIndex, 1);
                        removed = true;
                    }
                }
                
                if (removed) {
                    updateChat({ messages: chat.messages });
                }
                
                // Show welcome message if no messages left
                if (chat.messages.length === 0) {
                    showWelcomeMessage();
                }
            }, 300);
            break;
            
        case 'retry':
            if (sender === 'user') {                
                // Resend the message
                if (messageRecord && Array.isArray(messageRecord.attachments)) {
                    pendingAttachments = messageRecord.attachments.map(att => ({ ...att }));
                } else {
                    pendingAttachments = [];
                }
                updateAttachmentPreview();
                messageInput.value = text;
                messageInput.focus();
                messageInput.style.height = 'auto';
                messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
                updateSendButtonState();
                sendMessage();
            } else {
                alert('Retry the previous user message to get a new AI response');
            }
            break;
    }
}

// Scroll to bottom
function scrollToBottom() {
    setTimeout(() => {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }, 100);
}

// Show welcome message
function showWelcomeMessage() {
    const welcomeDiv = document.createElement('div');
    welcomeDiv.className = 'welcome-message';
    welcomeDiv.innerHTML = `
        <h2>welcome</h2>
        <p>start</p>
    `;
    chatContainer.appendChild(welcomeDiv);
}

// Gemini API integration
async function CallGeminiApi(chat) {
    const apiKey = (globalSettings.apiKey || '').trim();
    if (!apiKey) {
        throw new Error('Gemini API key is missing.');
    }

    const selectedModel = (globalSettings.model || DEFAULT_GLOBAL_SETTINGS.model || '').trim();
    const model = selectedModel || DEFAULT_GLOBAL_SETTINGS.model;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    
    const conversation = chat.messages.slice(-512)
        .map(msg => {
            const parts = buildMessageParts(msg);
            if (parts.length === 0) {
                return null;
            }

            return {
                role: msg.sender === 'ai' ? 'model' : 'user',
                parts
            };
        })
        .filter(Boolean);

    if (conversation.length === 0) {
        throw new Error('No conversation content to send.');
    }

    const temperatureSetting = typeof globalSettings.temperature === 'number'
        ? Math.min(1, Math.max(0, globalSettings.temperature))
        : DEFAULT_GLOBAL_SETTINGS.temperature;
    const maxTokensSetting = typeof globalSettings.maxOutputTokens === 'number'
        ? Math.min(8192, Math.max(1, Math.floor(globalSettings.maxOutputTokens)))
        : DEFAULT_GLOBAL_SETTINGS.maxOutputTokens;

    const payload = {
        contents: conversation,
        generationConfig: {
            temperature: temperatureSetting,
            maxOutputTokens: maxTokensSetting
        }
    };

    if (chat.settings.systemInstructions) {
        payload.system_instruction = {
            parts: [{ text: chat.settings.systemInstructions }]
        };
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Gemini API request failed (${response.status}): ${errorBody}`);
    }

    const data = await response.json();

    if (data.error) {
        throw new Error(data.error.message || 'Gemini API returned an error.');
    }

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map(part => part.text || '').join('').trim();

    if (!text) {
        throw new Error('Gemini response did not include any text.');
    }

    return text;
}