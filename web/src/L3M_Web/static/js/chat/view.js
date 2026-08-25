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

/**
 * The view depends only on this published state shape, not on controller
 * internals. Keeping that boundary explicit makes the renderer easy to test.
 *
 * @typedef {Object} ChatViewState
 * @property {string} usernameInput
 * @property {{id: string, username: string}|null} currentUser
 * @property {Array<{id: string, title: string, updated_at: string, last_message_preview?: string|null}>} chatSummaries
 * @property {{id: string, title: string, updated_at: string, messages: Array<{id: string, role: "user"|"assistant", content: string, created_at: string, attachments?: Array<{name: string, size: number}>}>}|null} selectedChat
 * @property {File[]} draftAttachments
 * @property {boolean} isSendingMessage
 * @property {boolean} enterToSend
 * @property {string[]} availableModels
 * @property {string} selectedModel
 * @property {{chatId: string, userContent: string, attachments: File[], assistantContent: string, startedAt: string}|null} pendingExchange
 */

/**
 * Required elements from the chat page template.
 *
 * @typedef {Object} ChatElements
 * @property {HTMLElement} app
 * @property {HTMLInputElement} usernameInput
 * @property {HTMLButtonElement} newChatButton
 * @property {HTMLElement} chatList
 * @property {HTMLElement} chatCount
 * @property {HTMLElement} chatTitle
 * @property {HTMLElement} chatMetadata
 * @property {HTMLElement} messageHistory
 * @property {HTMLFormElement} composer
 * @property {HTMLTextAreaElement} messageInput
 * @property {HTMLButtonElement} sendButton
 * @property {HTMLSelectElement} modelSelect
 * @property {HTMLInputElement} enterToggle
 * @property {HTMLElement} formatHint
 * @property {HTMLInputElement} fileInput
 * @property {HTMLElement} attachmentList
 * @property {HTMLButtonElement} menuButton
 * @property {HTMLElement} sidebarScrim
 * @property {HTMLElement} apiStatus
 * @property {HTMLElement} apiStatusContainer
 */

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
    modelSelect: "[data-model-select]",
    enterToggle: "[data-enter-toggle]",
    formatHint: "[data-format-hint]",
    fileInput: "[data-file-input]",
    attachmentList: "[data-attachment-list]",
    menuButton: "[data-menu-button]",
    sidebarScrim: "[data-sidebar-scrim]",
    apiStatus: "[data-api-status]",
    apiStatusContainer: "[data-api-status-wrap]"
});

/**
 * Fail during initialization instead of producing a later, ambiguous null
 * reference when the template and JavaScript selectors drift apart.
 *
 * @param {Document} rootDocument
 * @param {string} name
 * @param {string} selector
 * @returns {Element}
 */
function findRequiredElement(rootDocument, name, selector) {
    const element = rootDocument.querySelector(selector);
    if (!element) {
        throw new Error(
            `Chat view is missing required element "${name}" (${selector})`
        );
    }
    return element;
}

/**
 * @param {Document} rootDocument
 * @param {Element} app
 * @returns {Readonly<ChatElements>}
 */
function collectElements(rootDocument, app) {
    const elements = { app };
    Object.entries(ELEMENT_SELECTORS).forEach(([name, selector]) => {
        elements[name] = findRequiredElement(rootDocument, name, selector);
    });
    return /** @type {Readonly<ChatElements>} */ (Object.freeze(elements));
}

/**
 * Create the DOM adapter for a page containing a chat application root.
 *
 * @param {Document} [rootDocument]
 * @param {typeof requestAnimationFrame} [scheduleFrame]
 * @returns {Readonly<Object>|null}
 */
export function createChatView(
    rootDocument = globalThis.document,
    scheduleFrame = globalThis.requestAnimationFrame
) {
    const app = rootDocument?.querySelector("[data-chat-app]");
    if (!app) return null;
    const elements = collectElements(rootDocument, app);

    /** @param {string} status @param {string} message @returns {void} */
    function renderStatus(status, message) {
        elements.apiStatusContainer.dataset.state = status;
        elements.apiStatus.textContent = message;
    }

    /** @param {ChatViewState} state @returns {void} */
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

    /** @param {ChatViewState} state @returns {void} */
    function renderConversation(state) {
        const chat = state.selectedChat;
        const pendingMessages = state.pendingExchange
            && state.pendingExchange.chatId === chat?.id
            ? [
                {
                    id: "pending-user",
                    role: "user",
                    content: state.pendingExchange.userContent,
                    attachments: state.pendingExchange.attachments,
                    created_at: state.pendingExchange.startedAt,
                    isStreaming: true
                },
                {
                    id: "pending-assistant",
                    role: "assistant",
                    content: state.pendingExchange.assistantContent,
                    attachments: [],
                    created_at: state.pendingExchange.startedAt,
                    isStreaming: true
                }
            ]
            : [];
        const conversationMessages = [
            ...(chat?.messages || []),
            ...pendingMessages
        ];
        if (!chat || conversationMessages.length === 0) {
            elements.messageHistory.innerHTML = [
                '<div class="welcome">',
                '<div class="welcome-mark" aria-hidden="true">✦</div>',
                "<h2>What are we working on?</h2>",
                "<p>Ask a question, paste some code, or attach files. ",
                "Conversations are loaded from the local API.</p>",
                "</div>"
            ].join("");
        } else {
            const messages = conversationMessages.map((message) => {
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

                article.className = `message ${roleClass}${message.isStreaming ? " streaming" : ""}`;
                const messageBody = message.isStreaming
                    && !message.content
                    ? '<span class="typing-indicator" aria-label="Generating response"><span></span><span></span><span></span></span>'
                    : formatMessage(message.content);
                article.innerHTML = [
                    `<div class="message-avatar" aria-hidden="true">${escapeHtml(avatar)}</div>`,
                    "<div>",
                    '<div class="message-heading">',
                    `<span class="message-author">${escapeHtml(author)}</span>`,
                    `<time class="message-time" datetime="${escapeHtml(message.created_at)}">${shortTime(message.created_at)}</time>`,
                    "</div>",
                    `<div class="message-body">${messageBody}</div>`,
                    attachments
                        ? `<div class="message-attachments">${attachments}</div>`
                        : "",
                    "</div>"
                ].join("");
                return article;
            });
            elements.messageHistory.replaceChildren(...messages);
        }

        // Rendering may change the history height. Scroll on the next frame so
        // layout has incorporated the newly inserted message elements.
        scheduleFrame(() => {
            elements.messageHistory.scrollTop = elements.messageHistory.scrollHeight;
        });
    }

    /** @param {ChatViewState} state @returns {void} */
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

    /** @param {ChatViewState} state @returns {void} */
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
        elements.enterToggle.checked = state.enterToSend;
        elements.formatHint.innerHTML = state.enterToSend
            ? '<kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line'
            : '<kbd>Shift</kbd> + <kbd>Enter</kbd> to send';
        if (state.selectedModel) {
            elements.modelSelect.value = state.selectedModel;
        }
    }

    /** @param {ChatViewState} state @returns {void} */
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

    /** @param {string} value @returns {void} */
    function setUsernameInput(value) {
        elements.usernameInput.value = value;
    }

    /**
     * Do not erase text typed while a send request was in flight.
     *
     * @param {string} submittedText
     * @returns {boolean} Whether the submitted draft was cleared.
     */
    function clearDraftTextIfUnchanged(submittedText) {
        if (elements.messageInput.value !== submittedText) return false;
        elements.messageInput.value = "";
        return true;
    }

    /** @returns {void} */
    function clearFileInput() {
        elements.fileInput.value = "";
    }

    /** @returns {void} */
    function focusMessageInput() {
        elements.messageInput.focus();
    }

    /** @returns {void} */
    function closeSidebar() {
        elements.app.classList.remove("sidebar-open");
        elements.menuButton.setAttribute("aria-expanded", "false");
    }

    /** @returns {boolean} Current open state. */
    function toggleSidebar() {
        const isOpen = elements.app.classList.toggle("sidebar-open");
        elements.menuButton.setAttribute("aria-expanded", String(isOpen));
        return isOpen;
    }

    /** @returns {{models: string[], defaultModel: string}} */
    function getModelConfiguration() {
        return {
            models: Array.from(elements.modelSelect.options)
                .map((option) => option.value)
                .filter(Boolean),
            defaultModel: elements.modelSelect.dataset.defaultModel || ""
        };
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
        toggleSidebar,
        getModelConfiguration
    });
}
