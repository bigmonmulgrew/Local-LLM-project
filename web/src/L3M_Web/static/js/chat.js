import { createChatApi } from "./chat/api.js";
import {
    escapeHtml,
    formatBytes,
    formatMessage,
    relativeDate,
    shortTime
} from "./chat/formatting.js";

const api = createChatApi();

(() => {
    "use strict";

    const USER_KEY = "l3m-chat-username";
    const OLD_CHAT_KEY = "l3m-chat-prototype-v1";
    const app = document.querySelector("[data-chat-app]");
    if (!app) return;

    const elements = {
        username: document.querySelector("#username"),
        newChat: document.querySelector("[data-new-chat]"),
        chatList: document.querySelector("[data-chat-list]"),
        chatCount: document.querySelector("[data-chat-count]"),
        title: document.querySelector("[data-chat-title]"),
        meta: document.querySelector("[data-chat-meta]"),
        messages: document.querySelector("[data-messages]"),
        composer: document.querySelector("[data-composer]"),
        input: document.querySelector("[data-message-input]"),
        send: document.querySelector("[data-send-button]"),
        fileInput: document.querySelector("[data-file-input]"),
        attachmentList: document.querySelector("[data-attachment-list]"),
        menuButton: document.querySelector("[data-menu-button]"),
        scrim: document.querySelector("[data-sidebar-scrim]"),
        apiStatus: document.querySelector("[data-api-status]"),
        apiStatusWrap: document.querySelector("[data-api-status-wrap]")
    };

    const savedUsername = localStorage.getItem(USER_KEY) || "";
    let confirmedUser = null;
    let chats = [];
    let activeChat = null;
    let pendingFiles = [];
    let usernameTimer = null;
    let usernameRevision = 0;
    let usernameConfirmation = null;
    let chatListRequestVersion = 0;
    let chatSelectionRequestVersion = 0;
    let busy = false;

    localStorage.removeItem(OLD_CHAT_KEY);
    elements.username.value = savedUsername;

    function setApiStatus(state, message) {
        elements.apiStatusWrap.dataset.state = state;
        elements.apiStatus.textContent = message;
    }

    function invalidateChatRequests() {
        chatListRequestVersion += 1;
        chatSelectionRequestVersion += 1;
    }

    function renderChatList() {
        elements.chatCount.textContent = String(chats.length);
        if (!chats.length) {
            elements.chatList.innerHTML = '<p class="chat-empty">No conversations for this user yet. Create one to get started.</p>';
            return;
        }
        elements.chatList.replaceChildren(...chats.map((chat) => {
            const item = document.createElement("div");
            item.className = "chat-list-item";
            item.dataset.chatId = chat.id;
            item.tabIndex = 0;
            item.setAttribute("role", "button");
            if (chat.id === activeChat?.id) item.setAttribute("aria-current", "page");
            item.innerHTML = `<span class="chat-list-copy"><span class="chat-list-title">${escapeHtml(chat.title)}</span><span class="chat-list-preview">${escapeHtml(chat.last_message_preview || "No messages yet")}</span></span><span class="chat-actions"><button class="rename-chat" type="button" data-rename-chat="${chat.id}" aria-label="Rename ${escapeHtml(chat.title)}" title="Rename chat">✎</button><button class="delete-chat" type="button" data-delete-chat="${chat.id}" aria-label="Delete ${escapeHtml(chat.title)}" title="Delete chat">×</button></span>`;
            return item;
        }));
    }

    function renderMessages() {
        if (!activeChat || activeChat.messages.length === 0) {
            elements.messages.innerHTML = '<div class="welcome"><div class="welcome-mark" aria-hidden="true">✦</div><h2>What are we working on?</h2><p>Ask a question, paste some code, or attach files. Conversations are loaded from the local API.</p></div>';
        } else {
            elements.messages.replaceChildren(...activeChat.messages.map((message) => {
                const article = document.createElement("article");
                article.className = `message ${message.role}`;
                const name = message.role === "user" ? confirmedUser?.username || "User" : "L3M";
                const avatar = message.role === "user" ? name.slice(0, 2).toUpperCase() : "L3";
                const attachments = (message.attachments || [])
                    .map((file) => `<span class="message-file">📎 ${escapeHtml(file.name)} · ${formatBytes(file.size)}</span>`)
                    .join("");
                article.innerHTML = `<div class="message-avatar" aria-hidden="true">${escapeHtml(avatar)}</div><div><div class="message-heading"><span class="message-author">${escapeHtml(name)}</span><time class="message-time" datetime="${escapeHtml(message.created_at)}">${shortTime(message.created_at)}</time></div><div class="message-body">${formatMessage(message.content)}</div>${attachments ? `<div class="message-attachments">${attachments}</div>` : ""}</div>`;
                return article;
            }));
        }
        requestAnimationFrame(() => { elements.messages.scrollTop = elements.messages.scrollHeight; });
    }

    function renderAttachments() {
        elements.attachmentList.replaceChildren(...pendingFiles.map((file, index) => {
            const chip = document.createElement("span");
            chip.className = "attachment-chip";
            chip.innerHTML = `<span>📎 ${escapeHtml(file.name)} · ${formatBytes(file.size)}</span><button type="button" data-remove-file="${index}" aria-label="Remove ${escapeHtml(file.name)}">×</button>`;
            return chip;
        }));
    }

    function updateComposer() {
        elements.input.style.height = "auto";
        elements.input.style.height = `${Math.min(elements.input.scrollHeight, 180)}px`;
        elements.send.disabled = busy || (!elements.input.value.trim() && pendingFiles.length === 0);
    }

    function render() {
        elements.title.textContent = activeChat?.title || "New conversation";
        elements.meta.textContent = activeChat
            ? `${activeChat.messages.length} message${activeChat.messages.length === 1 ? "" : "s"} · ${relativeDate(activeChat.updated_at)}`
            : "Start a conversation below";
        renderChatList();
        renderMessages();
        renderAttachments();
        updateComposer();
    }

    async function loadChats({ preserveActive = false } = {}) {
        if (!confirmedUser) return;
        const userId = confirmedUser.id;
        const requestVersion = ++chatListRequestVersion;
        if (!preserveActive) activeChat = null;
        setApiStatus("connecting", "Loading chats…");
        try {
            const loadedChats = await api.listChats(userId);
            if (
                requestVersion !== chatListRequestVersion
                || confirmedUser?.id !== userId
            ) {
                return;
            }
            chats = loadedChats;
            setApiStatus("ready", "API connected");
            render();
        } catch (error) {
            if (
                requestVersion !== chatListRequestVersion
                || confirmedUser?.id !== userId
            ) {
                return;
            }
            chats = [];
            setApiStatus("error", "API unavailable");
            render();
            console.error(error);
        }
    }

    async function selectChat(chatId) {
        if (!confirmedUser) return;
        const userId = confirmedUser.id;
        const requestVersion = ++chatSelectionRequestVersion;
        try {
            setApiStatus("connecting", "Loading conversation…");
            const loadedChat = await api.getChat(userId, chatId);
            if (
                requestVersion !== chatSelectionRequestVersion
                || confirmedUser?.id !== userId
            ) {
                return;
            }
            activeChat = loadedChat;
            setApiStatus("ready", "API connected");
            render();
            closeSidebar();
        } catch (error) {
            if (
                requestVersion !== chatSelectionRequestVersion
                || confirmedUser?.id !== userId
            ) {
                return;
            }
            setApiStatus("error", "Could not load chat");
            console.error(error);
        }
    }

    async function renameChat(chatId) {
        const userId = confirmedUser?.id;
        if (!userId) return;
        const chat = chats.find((item) => item.id === chatId);
        if (!chat) return;
        const title = window.prompt("Rename chat", chat.title);
        if (title === null) return;
        const cleanTitle = title.trim();
        if (!cleanTitle) {
            window.alert("Chat names cannot be blank.");
            return;
        }
        try {
            const updated = await api.renameChat(
                userId,
                chatId,
                cleanTitle.slice(0, 80)
            );
            if (confirmedUser?.id !== userId) return;
            if (activeChat?.id === updated.id) activeChat = updated;
            await loadChats({ preserveActive: true });
        } catch (error) {
            setApiStatus("error", "Rename failed");
            console.error(error);
        }
    }

    async function deleteChat(chatId) {
        const userId = confirmedUser?.id;
        if (!userId) return;
        try {
            await api.deleteChat(userId, chatId);
            if (confirmedUser?.id !== userId) return;
            if (activeChat?.id === chatId) activeChat = null;
            await loadChats({ preserveActive: true });
        } catch (error) {
            setApiStatus("error", "Delete failed");
            console.error(error);
        }
    }

    async function sendMessage() {
        const draftText = elements.input.value;
        const content = draftText.trim();
        const submittedFiles = [...pendingFiles];
        if (busy || (!content && pendingFiles.length === 0)) return;
        busy = true;
        let submittedUserId = null;
        updateComposer();
        try {
            const user = await ensureConfirmedUser();
            if (!user) return;
            submittedUserId = user.id;

            let targetChat = activeChat;
            if (!targetChat) {
                const title = content.replace(/[`*_>#]/g, "").slice(0, 42) || "New conversation";
                targetChat = await api.createChat(user.id, title);
                if (confirmedUser?.id === user.id) activeChat = targetChat;
            }

            const targetChatId = targetChat.id;
            setApiStatus("connecting", "Ollama is responding…");
            await api.sendMessage(user.id, targetChatId, {
                text: content,
                files: submittedFiles
            });

            // Preserve edits made while the submitted draft was in flight.
            if (elements.input.value === draftText) elements.input.value = "";
            elements.fileInput.value = "";
            pendingFiles = pendingFiles.filter((file) => !submittedFiles.includes(file));

            try {
                const listRequestVersion = ++chatListRequestVersion;
                const [updatedChat, updatedChats] = await Promise.all([
                    api.getChat(user.id, targetChatId),
                    api.listChats(user.id)
                ]);

                if (
                    listRequestVersion === chatListRequestVersion
                    && confirmedUser?.id === user.id
                ) {
                    chats = updatedChats;
                    if (activeChat?.id === targetChatId) activeChat = updatedChat;
                    setApiStatus("ready", "API connected");
                    render();
                    elements.input.focus();
                }
            } catch (refreshError) {
                if (confirmedUser?.id === user.id) {
                    setApiStatus("error", "Message sent; refresh failed");
                    render();
                }
                console.error(refreshError);
            }
        } catch (error) {
            if (submittedUserId === null || confirmedUser?.id === submittedUserId) {
                setApiStatus("error", "Message failed");
            }
            console.error(error);
        } finally {
            busy = false;
            updateComposer();
        }
    }

    async function startNewChat() {
        if (!await ensureConfirmedUser()) return;
        chatSelectionRequestVersion += 1;
        activeChat = null;
        pendingFiles = [];
        elements.fileInput.value = "";
        render();
        elements.input.focus();
        closeSidebar();
    }

    function closeSidebar() {
        app.classList.remove("sidebar-open");
        elements.menuButton.setAttribute("aria-expanded", "false");
    }

    async function confirmUsername() {
        clearTimeout(usernameTimer);
        const username = elements.username.value.trim();
        localStorage.setItem(USER_KEY, elements.username.value);
        const revision = usernameRevision;

        if (!username) {
            usernameConfirmation = null;
            confirmedUser = null;
            chats = [];
            activeChat = null;
            invalidateChatRequests();
            setApiStatus("connecting", "Enter a username");
            render();
            return null;
        }

        if (confirmedUser?.username === username) return confirmedUser;

        if (
            usernameConfirmation?.username === username
            && usernameConfirmation.revision === revision
        ) {
            return usernameConfirmation.promise;
        }

        setApiStatus("connecting", "Confirming username…");
        const promise = (async () => {
            try {
                const user = await api.resolveUser(username);
                if (
                    revision !== usernameRevision
                    || elements.username.value.trim() !== username
                ) {
                    return null;
                }

                confirmedUser = user;
                activeChat = null;
                chatSelectionRequestVersion += 1;
                await loadChats();

                if (
                    revision !== usernameRevision
                    || elements.username.value.trim() !== username
                ) {
                    return null;
                }
                return user;
            } catch (error) {
                if (
                    revision === usernameRevision
                    && elements.username.value.trim() === username
                ) {
                    confirmedUser = null;
                    chats = [];
                    activeChat = null;
                    setApiStatus("error", "Username confirmation failed");
                    render();
                    console.error(error);
                }
                return null;
            } finally {
                if (usernameConfirmation?.promise === promise) {
                    usernameConfirmation = null;
                }
            }
        })();

        usernameConfirmation = { username, revision, promise };
        return promise;
    }

    async function ensureConfirmedUser() {
        const username = elements.username.value.trim();
        if (confirmedUser && confirmedUser.username === username) return confirmedUser;
        return confirmUsername();
    }

    elements.username.addEventListener("input", () => {
        const value = elements.username.value;
        localStorage.setItem(USER_KEY, value);
        usernameRevision += 1;
        usernameConfirmation = null;
        confirmedUser = null;
        chats = [];
        activeChat = null;
        invalidateChatRequests();
        setApiStatus("connecting", value.trim() ? "Waiting to confirm…" : "Enter a username");
        render();
        clearTimeout(usernameTimer);
        if (value.trim()) {
            usernameTimer = setTimeout(confirmUsername, 5000);
        }
    });
    elements.username.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            confirmUsername();
        }
    });
    elements.username.addEventListener("blur", confirmUsername);
    elements.newChat.addEventListener("click", startNewChat);
    elements.chatList.addEventListener("click", (event) => {
        const renameButton = event.target.closest("[data-rename-chat]");
        if (renameButton) {
            event.stopPropagation();
            renameChat(renameButton.dataset.renameChat);
            return;
        }
        const deleteButton = event.target.closest("[data-delete-chat]");
        if (deleteButton) {
            event.stopPropagation();
            deleteChat(deleteButton.dataset.deleteChat);
            return;
        }
        const item = event.target.closest("[data-chat-id]");
        if (item) selectChat(item.dataset.chatId);
    });
    elements.chatList.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-chat-id]")) {
            event.preventDefault();
            selectChat(event.target.dataset.chatId);
        }
    });
    elements.composer.addEventListener("submit", (event) => {
        event.preventDefault();
        sendMessage();
    });
    elements.input.addEventListener("input", updateComposer);
    elements.input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });
    elements.fileInput.addEventListener("change", () => {
        pendingFiles.push(...Array.from(elements.fileInput.files));
        renderAttachments();
        updateComposer();
    });
    elements.attachmentList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-remove-file]");
        if (!button) return;
        pendingFiles.splice(Number(button.dataset.removeFile), 1);
        renderAttachments();
        updateComposer();
    });
    elements.menuButton.addEventListener("click", () => {
        const open = app.classList.toggle("sidebar-open");
        elements.menuButton.setAttribute("aria-expanded", String(open));
    });
    elements.scrim.addEventListener("click", closeSidebar);

    render();
    if (savedUsername.trim()) {
        confirmUsername();
    } else {
        setApiStatus("connecting", "Enter a username");
    }
})();