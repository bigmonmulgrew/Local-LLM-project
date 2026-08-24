/**
 * DOM adapter and renderer for the chat interface.
 *
 * The view reads controller snapshots and updates the page. It does not make
 * API calls or mutate application state.
 */

import {
    escapeHtml,
    formatBytes,
    formatMessage,
    relativeDate,
    shortTime
} from "./formatting.js";

const ELEMENT_SELECTORS = Object.freeze({
    usernameInput: "#username",
    newChatButton: "[data-new-chat]",
    chatList: "[data-chat-list]",
    chatCount: "[data-chat-count]",
    chatTitle: "[data-chat-title]",
    chatMetadata: "[data-chat-meta]",
    messageHistory: "[data-messages]",
    composer: "[data-composer]",
    messageInput: "[data-message-input]",
    sendButton: "[data-send-button]",
    fileInput: "[data-file-input]",
    attachmentList: "[data-attachment-list]",
    menuButton: "[data-menu-button]",
    sidebarScrim: "[data-sidebar-scrim]",
    apiStatus: "[data-api-status]",
    apiStatusContainer: "[data-api-status-wrap]"
});

function findRequiredElement(rootDocument, name, selector) {
    const element = rootDocument.querySelector(selector);
    if (!element) {
        throw new Error( `Chat view is missing required element "${name}" (${selector})` );
    }
    return element;
}

function collectElements(rootDocument, app) {
    const elements = { app };
    Object.entries(ELEMENT_SELECTORS).forEach(([name, selector]) => {
        elements[name] = findRequiredElement(rootDocument, name, selector);
    });
    return Object.freeze(elements);
}

export function createChatView(
    rootDocument = globalThis.document,
    scheduleFrame = globalThis.requestAnimationFrame
) {
    const app = rootDocument?.querySelector("[data-chat-app]");
    if (!app) return null;
    const elements = collectElements(rootDocument, app);

    function renderStatus(status, message) {
        elements.apiStatusContainer.dataset.state = status;
        elements.apiStatus.textContent = message;
    }

    function renderChatList(state) {
        elements.chatCount.textContent = String(state.chatSummaries.length);
        if (!state.chatSummaries.length) {
            elements.chatList.innerHTML = [
                '<p class="chat-empty">',
                "No conversations for this user yet. Create one to get started.",
                "</p>"
            ].join("");
            return;
        }

        const chatItems = state.chatSummaries.map((chat) => {
            const item = rootDocument.createElement("div");
            const chatId = escapeHtml(chat.id);
            const chatTitle = escapeHtml(chat.title);

            item.className = "chat-list-item";
            item.dataset.chatId = chat.id;
            item.tabIndex = 0;
            item.setAttribute("role", "button");
            if (chat.id === state.selectedChat?.id) {
                item.setAttribute("aria-current", "page");
            }

            item.innerHTML = [
                '<span class="chat-list-copy">',
                `<span class="chat-list-title">${chatTitle}</span>`,
                '<span class="chat-list-preview">',
                escapeHtml(chat.last_message_preview || "No messages yet"),
                "</span></span>",
                '<span class="chat-actions">',
                `<button class="rename-chat" type="button" data-rename-chat="${chatId}" aria-label="Rename ${chatTitle}" title="Rename chat">✎</button>`,
                `<button class="delete-chat" type="button" data-delete-chat="${chatId}" aria-label="Delete ${chatTitle}" title="Delete chat">×</button>`,
                "</span>"
            ].join("");
            return item;
        });

        elements.chatList.replaceChildren(...chatItems);
    }

    function renderConversation(state) {
        const chat = state.selectedChat;
        if (!chat || chat.messages.length === 0) {
            elements.messageHistory.innerHTML = [
                '<div class="welcome">',
                '<div class="welcome-mark" aria-hidden="true">✦</div>',
                "<h2>What are we working on?</h2>",
                "<p>Ask a question, paste some code, or attach files. ",
                "Conversations are loaded from the local API.</p>",
                "</div>"
            ].join("");
        } else {
            const messages = chat.messages.map((message) => {
                const article = rootDocument.createElement("article");
                const isUser = message.role === "user";
                const roleClass = isUser ? "user" : "assistant";
                const author = isUser
                    ? state.currentUser?.username || "User"
                    : "L3M";
                const avatar = isUser
                    ? author.slice(0, 2).toUpperCase()
                    : "L3";
                const attachments = (message.attachments || [])
                    .map((file) => [
                        '<span class="message-file">📎 ',
                        escapeHtml(file.name),
                        ` · ${formatBytes(file.size)}</span>`
                    ].join(""))
                    .join("");

                article.className = `message ${roleClass}`;
                article.innerHTML = [
                    `<div class="message-avatar" aria-hidden="true">${escapeHtml(avatar)}</div>`,
                    "<div>",
                    '<div class="message-heading">',
                    `<span class="message-author">${escapeHtml(author)}</span>`,
                    `<time class="message-time" datetime="${escapeHtml(message.created_at)}">${shortTime(message.created_at)}</time>`,
                    "</div>",
                    `<div class="message-body">${formatMessage(message.content)}</div>`,
                    attachments
                        ? `<div class="message-attachments">${attachments}</div>`
                        : "",
                    "</div>"
                ].join("");
                return article;
            });
            elements.messageHistory.replaceChildren(...messages);
        }

        scheduleFrame(() => {
            elements.messageHistory.scrollTop = elements.messageHistory.scrollHeight;
        });
    }

    function renderDraft(state) {
        const attachments = state.draftAttachments.map((file, index) => {
            const chip = rootDocument.createElement("span");
            chip.className = "attachment-chip";
            chip.innerHTML = [
                `<span>📎 ${escapeHtml(file.name)} · ${formatBytes(file.size)}</span>`,
                `<button type="button" data-remove-file="${index}" aria-label="Remove ${escapeHtml(file.name)}">×</button>`
            ].join("");
            return chip;
        });
        elements.attachmentList.replaceChildren(...attachments);
    }

    function updateComposer(state) {
        elements.messageInput.style.height = "auto";
        elements.messageInput.style.height = `${Math.min(
            elements.messageInput.scrollHeight,
            180
        )}px`;
        elements.sendButton.disabled = state.isSendingMessage
            || (
                !elements.messageInput.value.trim()
                && state.draftAttachments.length === 0
            );
    }

    function render(state) {
        const chat = state.selectedChat;
        elements.chatTitle.textContent = chat?.title || "New conversation";
        elements.chatMetadata.textContent = chat
            ? `${chat.messages.length} message${chat.messages.length === 1 ? "" : "s"} · ${relativeDate(chat.updated_at)}`
            : "Start a conversation below";
        renderChatList(state);
        renderConversation(state);
        renderDraft(state);
        updateComposer(state);
    }

    function setUsernameInput(value) {
        elements.usernameInput.value = value;
    }

    function clearDraftTextIfUnchanged(submittedText) {
        if (elements.messageInput.value !== submittedText) return false;
        elements.messageInput.value = "";
        return true;
    }

    function clearFileInput() {
        elements.fileInput.value = "";
    }

    function focusMessageInput() {
        elements.messageInput.focus();
    }

    function closeSidebar() {
        elements.app.classList.remove("sidebar-open");
        elements.menuButton.setAttribute("aria-expanded", "false");
    }

    function toggleSidebar() {
        const isOpen = elements.app.classList.toggle("sidebar-open");
        elements.menuButton.setAttribute("aria-expanded", String(isOpen));
        return isOpen;
    }

    return Object.freeze({
        elements,
        render,
        renderStatus,
        updateComposer,
        setUsernameInput,
        clearDraftTextIfUnchanged,
        clearFileInput,
        focusMessageInput,
        closeSidebar,
        toggleSidebar
    });
}