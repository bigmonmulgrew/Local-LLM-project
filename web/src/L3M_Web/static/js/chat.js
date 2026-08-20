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
    let currentUser = savedUsername.trim() || "Guest";
    let chats = [];
    let activeChat = null;
    let pendingFiles = [];
    let usernameTimer = null;
    let busy = false;

    localStorage.removeItem(OLD_CHAT_KEY);
    elements.username.value = savedUsername;

    function setApiStatus(state, message) {
        elements.apiStatusWrap.dataset.state = state;
        elements.apiStatus.textContent = message;
    }

    async function apiRequest(path, options = {}) {
        const headers = options.body instanceof FormData
            ? options.headers
            : { "Content-Type": "application/json", ...options.headers };
        const response = await fetch(path, { ...options, headers });

        if (!response.ok) {
            let detail = `Request failed with status ${response.status}`;
            try {
                const body = await response.json();
                detail = body.detail || detail;
            } catch (_) {
                // The response did not contain JSON.
            }
            throw new Error(detail);
        }
        return response.status === 204 ? null : response.json();
    }

    function userQuery() {
        return new URLSearchParams({ user: currentUser }).toString();
    }

    function escapeHtml(value) {
        const node = document.createElement("div");
        node.textContent = String(value ?? "");
        return node.innerHTML;
    }

    function inlineFormat(text) {
        return escapeHtml(text)
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/\*([^*]+)\*/g, "<em>$1</em>");
    }

    function formatMessage(source) {
        const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
        const output = [];
        let paragraph = [];
        let quote = [];
        let code = [];
        let language = "code";
        let inCode = false;
        const flushParagraph = () => {
            if (paragraph.length) output.push(`<p>${paragraph.map(inlineFormat).join("<br>")}</p>`);
            paragraph = [];
        };
        const flushQuote = () => {
            if (quote.length) output.push(`<blockquote>${quote.map(inlineFormat).join("<br>")}</blockquote>`);
            quote = [];
        };

        lines.forEach((line) => {
            if (line.startsWith("```")) {
                if (inCode) {
                    output.push(`<pre data-language="${escapeHtml(language)}"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
                    code = [];
                    inCode = false;
                } else {
                    flushParagraph();
                    flushQuote();
                    language = line.slice(3).trim() || "code";
                    inCode = true;
                }
                return;
            }
            if (inCode) code.push(line);
            else if (line.startsWith("> ")) {
                flushParagraph();
                quote.push(line.slice(2));
            } else {
                flushQuote();
                if (line.trim()) paragraph.push(line);
                else flushParagraph();
            }
        });

        if (inCode) output.push(`<pre data-language="${escapeHtml(language)}"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        flushQuote();
        flushParagraph();
        return output.join("");
    }

    function shortTime(iso) {
        return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    }

    function relativeDate(iso) {
        const date = new Date(iso);
        const today = new Date();
        if (date.toDateString() === today.toDateString()) return `Today, ${shortTime(iso)}`;
        return new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(date);
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
                const name = message.role === "user" ? currentUser : "L3M";
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
        setApiStatus("connecting", "Loading chats…");
        try {
            chats = await apiRequest(`/api/chats?${userQuery()}`);
            if (!preserveActive) activeChat = null;
            setApiStatus("ready", "API connected");
            render();
        } catch (error) {
            chats = [];
            activeChat = null;
            setApiStatus("error", "API unavailable");
            render();
            console.error(error);
        }
    }

    async function selectChat(chatId) {
        try {
            setApiStatus("connecting", "Loading conversation…");
            activeChat = await apiRequest(`/api/chats/${encodeURIComponent(chatId)}?${userQuery()}`);
            setApiStatus("ready", "API connected");
            render();
            closeSidebar();
        } catch (error) {
            setApiStatus("error", "Could not load chat");
            console.error(error);
        }
    }

    async function createChat(title) {
        return apiRequest("/api/chats", {
            method: "POST",
            body: JSON.stringify({ user: currentUser, title })
        });
    }

    async function renameChat(chatId) {
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
            const updated = await apiRequest(`/api/chats/${encodeURIComponent(chatId)}`, {
                method: "PATCH",
                body: JSON.stringify({ user: currentUser, title: cleanTitle.slice(0, 80) })
            });
            if (activeChat?.id === updated.id) activeChat = updated;
            await loadChats({ preserveActive: true });
        } catch (error) {
            setApiStatus("error", "Rename failed");
            console.error(error);
        }
    }

    async function deleteChat(chatId) {
        try {
            await apiRequest(`/api/chats/${encodeURIComponent(chatId)}?${userQuery()}`, { method: "DELETE" });
            if (activeChat?.id === chatId) activeChat = null;
            await loadChats({ preserveActive: true });
        } catch (error) {
            setApiStatus("error", "Delete failed");
            console.error(error);
        }
    }

    async function sendMessage() {
        const content = elements.input.value.trim();
        if (busy || (!content && pendingFiles.length === 0)) return;
        busy = true;
        updateComposer();
        try {
            if (!activeChat) {
                const title = content.replace(/[`*_>#]/g, "").slice(0, 42) || "New conversation";
                activeChat = await createChat(title);
            }
            const body = new FormData();
            body.append("user", currentUser);
            body.append("role", "user");
            body.append("text", content);
            pendingFiles.forEach((file) => body.append("files", file, file.name));
            setApiStatus("connecting", "Ollama is responding…");
            await apiRequest(`/api/chats/${encodeURIComponent(activeChat.id)}/messages`, {
                method: "POST",
                body
            });
            elements.input.value = "";
            elements.fileInput.value = "";
            pendingFiles = [];
            activeChat = await apiRequest(`/api/chats/${encodeURIComponent(activeChat.id)}?${userQuery()}`);
            chats = await apiRequest(`/api/chats?${userQuery()}`);
            setApiStatus("ready", "API connected");
            render();
            elements.input.focus();
        } catch (error) {
            setApiStatus("error", "Message failed");
            console.error(error);
        } finally {
            busy = false;
            updateComposer();
        }
    }

    function startNewChat() {
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

    elements.username.addEventListener("input", () => {
        const value = elements.username.value;
        localStorage.setItem(USER_KEY, value);
        currentUser = value.trim() || "Guest";
        activeChat = null;
        pendingFiles = [];
        clearTimeout(usernameTimer);
        usernameTimer = setTimeout(() => loadChats(), 350);
    });
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
    loadChats();
})();