import { createChatApi } from "./chat/api.js";
import { createChatController } from "./chat/controller.js";
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

    function setApiStatus(status, message) {
        elements.apiStatusWrap.dataset.state = status;
        elements.apiStatus.textContent = message;
    }

    function renderChatList(state) {
        elements.chatCount.textContent = String(state.chatSummaries.length);
        if (!state.chatSummaries.length) {
            elements.chatList.innerHTML = '<p class="chat-empty">No conversations for this user yet. Create one to get started.</p>';
            return;
        }

        elements.chatList.replaceChildren(...state.chatSummaries.map((chat) => {
            const item = document.createElement("div");
            item.className = "chat-list-item";
            item.dataset.chatId = chat.id;
            item.tabIndex = 0;
            item.setAttribute("role", "button");
            if (chat.id === state.selectedChat?.id) {
                item.setAttribute("aria-current", "page");
            }
            item.innerHTML = `<span class="chat-list-copy"><span class="chat-list-title">${escapeHtml(chat.title)}</span><span class="chat-list-preview">${escapeHtml(chat.last_message_preview || "No messages yet")}</span></span><span class="chat-actions"><button class="rename-chat" type="button" data-rename-chat="${chat.id}" aria-label="Rename ${escapeHtml(chat.title)}" title="Rename chat">✎</button><button class="delete-chat" type="button" data-delete-chat="${chat.id}" aria-label="Delete ${escapeHtml(chat.title)}" title="Delete chat">×</button></span>`;
            return item;
        }));
    }

    function renderMessages(state) {
        const chat = state.selectedChat;
        if (!chat || chat.messages.length === 0) {
            elements.messages.innerHTML = '<div class="welcome"><div class="welcome-mark" aria-hidden="true">✦</div><h2>What are we working on?</h2><p>Ask a question, paste some code, or attach files. Conversations are loaded from the local API.</p></div>';
        } else {
            elements.messages.replaceChildren(...chat.messages.map((message) => {
                const article = document.createElement("article");
                article.className = `message ${message.role}`;
                const name = message.role === "user"
                    ? state.currentUser?.username || "User"
                    : "L3M";
                const avatar = message.role === "user"
                    ? name.slice(0, 2).toUpperCase()
                    : "L3";
                const attachments = (message.attachments || [])
                    .map((file) => `<span class="message-file">📎 ${escapeHtml(file.name)} · ${formatBytes(file.size)}</span>`)
                    .join("");
                article.innerHTML = `<div class="message-avatar" aria-hidden="true">${escapeHtml(avatar)}</div><div><div class="message-heading"><span class="message-author">${escapeHtml(name)}</span><time class="message-time" datetime="${escapeHtml(message.created_at)}">${shortTime(message.created_at)}</time></div><div class="message-body">${formatMessage(message.content)}</div>${attachments ? `<div class="message-attachments">${attachments}</div>` : ""}</div>`;
                return article;
            }));
        }
        requestAnimationFrame(() => {
            elements.messages.scrollTop = elements.messages.scrollHeight;
        });
    }

    function renderAttachments(state) {
        elements.attachmentList.replaceChildren(...state.draftAttachments.map((file, index) => {
            const chip = document.createElement("span");
            chip.className = "attachment-chip";
            chip.innerHTML = `<span>📎 ${escapeHtml(file.name)} · ${formatBytes(file.size)}</span><button type="button" data-remove-file="${index}" aria-label="Remove ${escapeHtml(file.name)}">×</button>`;
            return chip;
        }));
    }

    function updateComposer(state) {
        elements.input.style.height = "auto";
        elements.input.style.height = `${Math.min(elements.input.scrollHeight, 180)}px`;
        elements.send.disabled = state.isSendingMessage
            || (!elements.input.value.trim() && state.draftAttachments.length === 0);
    }

    function render(state) {
        const chat = state.selectedChat;
        elements.title.textContent = chat?.title || "New conversation";
        elements.meta.textContent = chat
            ? `${chat.messages.length} message${chat.messages.length === 1 ? "" : "s"} · ${relativeDate(chat.updated_at)}`
            : "Start a conversation below";
        renderChatList(state);
        renderMessages(state);
        renderAttachments(state);
        updateComposer(state);
    }

    function closeSidebar() {
        app.classList.remove("sidebar-open");
        elements.menuButton.setAttribute("aria-expanded", "false");
    }

    const controller = createChatController({
        api,
        storage: localStorage,
        onStateChange: render,
        onStatusChange: setApiStatus
    });

    async function submitMessage() {
        const result = await controller.submitDraft(elements.input.value);
        if (!result.sent) return;

        if (elements.input.value === result.submittedText) {
            elements.input.value = "";
        }
        elements.fileInput.value = "";
        updateComposer(controller.getState());
        elements.input.focus();
    }

    async function showNewChat() {
        if (!await controller.showNewChat()) return;
        elements.fileInput.value = "";
        elements.input.focus();
        closeSidebar();
    }

    async function requestChatRename(chatId) {
        const chat = controller.getState().chatSummaries.find(
            (item) => item.id === chatId
        );
        if (!chat) return;

        const title = window.prompt("Rename chat", chat.title);
        if (title === null) return;
        const cleanTitle = title.trim();
        if (!cleanTitle) {
            window.alert("Chat names cannot be blank.");
            return;
        }
        await controller.renameChat(chatId, cleanTitle.slice(0, 80));
    }

    elements.username.addEventListener("input", () => {
        controller.updateUsernameInput(elements.username.value);
    });
    elements.username.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            controller.resolveUsername();
        }
    });
    elements.username.addEventListener("blur", () => {
        controller.resolveUsername();
    });
    elements.newChat.addEventListener("click", showNewChat);
    elements.chatList.addEventListener("click", (event) => {
        const renameButton = event.target.closest("[data-rename-chat]");
        if (renameButton) {
            event.stopPropagation();
            requestChatRename(renameButton.dataset.renameChat);
            return;
        }

        const deleteButton = event.target.closest("[data-delete-chat]");
        if (deleteButton) {
            event.stopPropagation();
            controller.deleteChat(deleteButton.dataset.deleteChat);
            return;
        }

        const item = event.target.closest("[data-chat-id]");
        if (item) {
            controller.selectChat(item.dataset.chatId).then((selected) => {
                if (selected) closeSidebar();
            });
        }
    });
    elements.chatList.addEventListener("keydown", (event) => {
        if (
            (event.key === "Enter" || event.key === " ")
            && event.target.matches("[data-chat-id]")
        ) {
            event.preventDefault();
            controller.selectChat(event.target.dataset.chatId).then((selected) => {
                if (selected) closeSidebar();
            });
        }
    });
    elements.composer.addEventListener("submit", (event) => {
        event.preventDefault();
        submitMessage();
    });
    elements.input.addEventListener("input", () => {
        updateComposer(controller.getState());
    });
    elements.input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submitMessage();
        }
    });
    elements.fileInput.addEventListener("change", () => {
        controller.addDraftAttachments(elements.fileInput.files);
    });
    elements.attachmentList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-remove-file]");
        if (!button) return;
        controller.removeDraftAttachment(Number(button.dataset.removeFile));
    });
    elements.menuButton.addEventListener("click", () => {
        const open = app.classList.toggle("sidebar-open");
        elements.menuButton.setAttribute("aria-expanded", String(open));
    });
    elements.scrim.addEventListener("click", closeSidebar);
    window.addEventListener("beforeunload", controller.dispose);

    const initialState = controller.getState();
    elements.username.value = initialState.usernameInput;
    render(initialState);
    if (initialState.usernameInput.trim()) {
        controller.resolveUsername();
    } else {
        setApiStatus("connecting", "Enter a username");
    }
})();