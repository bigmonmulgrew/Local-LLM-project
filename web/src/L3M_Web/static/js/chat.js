/**
 * Chat application entry point.
 *
 * This module assembles the API, controller and view, then translates browser
 * events into application actions. Domain workflows and rendering live in
 * their dedicated modules.
 */

import { createChatApi } from "./chat/api.js";
import { createChatController } from "./chat/controller.js";
import { createChatView } from "./chat/view.js";

const api = createChatApi();

(() => {
    "use strict";

    const view = createChatView();
    if (!view) return;
    const { elements } = view;

    const controller = createChatController({
        api,
        storage: localStorage,
        onStateChange: view.render,
        onStatusChange: view.renderStatus
    });

    /** Submit the current DOM draft and clear only the values actually sent. */
    async function submitCurrentDraft() {
        const result = await controller.submitDraft(elements.messageInput.value);
        if (!result.sent) return;

        view.clearDraftTextIfUnchanged(result.submittedText);
        view.clearFileInput();
        view.updateComposer(controller.getState());
        view.focusMessageInput();
    }

    /** @returns {Promise<void>} */
    async function openNewChat() {
        if (!await controller.showNewChat()) return;
        view.clearFileInput();
        view.focusMessageInput();
        view.closeSidebar();
    }

    /** @param {string} chatId @returns {Promise<void>} */
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

    /** @param {string} chatId @returns {Promise<void>} */
    async function selectChatAndCloseSidebar(chatId) {
        if (await controller.selectChat(chatId)) view.closeSidebar();
    }

    /**
     * @param {Event} event
     * @param {string} selector
     * @returns {Element|null}
     */
    function closestEventTarget(event, selector) {
        if (typeof event.target?.closest !== "function") return null;
        return event.target.closest(selector);
    }

    function handleUsernameInput() {
        controller.updateUsernameInput(elements.usernameInput.value);
    }

    /** @param {KeyboardEvent} event */
    function handleUsernameKeydown(event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        void controller.resolveUsername();
    }

    function handleUsernameBlur() {
        void controller.resolveUsername();
    }

    function handleNewChatClick() {
        void openNewChat();
    }

    /** @param {MouseEvent} event */
    function handleChatListClick(event) {
        const renameButton = closestEventTarget(event, "[data-rename-chat]");
        if (renameButton) {
            event.stopPropagation();
            void requestChatRename(renameButton.dataset.renameChat);
            return;
        }

        const deleteButton = closestEventTarget(event, "[data-delete-chat]");
        if (deleteButton) {
            event.stopPropagation();
            void controller.deleteChat(deleteButton.dataset.deleteChat);
            return;
        }

        const item = closestEventTarget(event, "[data-chat-id]");
        if (item) {
            void selectChatAndCloseSidebar(item.dataset.chatId);
        }
    }

    /** @param {KeyboardEvent} event */
    function handleChatListKeydown(event) {
        const isActivationKey = event.key === "Enter" || event.key === " ";
        const isChatItem = typeof event.target?.matches === "function"
            && event.target.matches("[data-chat-id]");
        if (!isActivationKey || !isChatItem) return;

        event.preventDefault();
        void selectChatAndCloseSidebar(event.target.dataset.chatId);
    }

    /** @param {SubmitEvent} event */
    function handleComposerSubmit(event) {
        event.preventDefault();
        void submitCurrentDraft();
    }

    function handleMessageInput() {
        view.updateComposer(controller.getState());
    }

    /** @param {KeyboardEvent} event */
    function handleMessageKeydown(event) {
        if (event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        void submitCurrentDraft();
    }

    function handleFileSelection() {
        controller.addDraftAttachments(elements.fileInput.files);
    }

    /** @param {MouseEvent} event */
    function handleAttachmentListClick(event) {
        const button = closestEventTarget(event, "[data-remove-file]");
        if (!button) return;
        controller.removeDraftAttachment(Number(button.dataset.removeFile));
    }

    function handleMenuButtonClick() {
        view.toggleSidebar();
    }

    function handleSidebarScrimClick() {
        view.closeSidebar();
    }

    function handleBeforeUnload() {
        controller.dispose();
    }

    function bindEvents() {
        elements.usernameInput.addEventListener("input", handleUsernameInput);
        elements.usernameInput.addEventListener("keydown", handleUsernameKeydown);
        elements.usernameInput.addEventListener("blur", handleUsernameBlur);
        elements.newChatButton.addEventListener("click", handleNewChatClick);
        elements.chatList.addEventListener("click", handleChatListClick);
        elements.chatList.addEventListener("keydown", handleChatListKeydown);
        elements.composer.addEventListener("submit", handleComposerSubmit);
        elements.messageInput.addEventListener("input", handleMessageInput);
        elements.messageInput.addEventListener("keydown", handleMessageKeydown);
        elements.fileInput.addEventListener("change", handleFileSelection);
        elements.attachmentList.addEventListener(
            "click",
            handleAttachmentListClick
        );
        elements.menuButton.addEventListener("click", handleMenuButtonClick);
        elements.sidebarScrim.addEventListener(
            "click",
            handleSidebarScrimClick
        );
        window.addEventListener("beforeunload", handleBeforeUnload);
    }

    // Initial rendering is synchronous; resolving a saved username then
    // hydrates server-owned conversation data without storing it in the browser.
    function initializeApplication() {
        bindEvents();
        const initialState = controller.getState();
        view.setUsernameInput(initialState.usernameInput);
        view.render(initialState);

        if (initialState.usernameInput.trim()) {
            void controller.resolveUsername();
        } else {
            view.renderStatus("connecting", "Enter a username");
        }
    }

    initializeApplication();
})();