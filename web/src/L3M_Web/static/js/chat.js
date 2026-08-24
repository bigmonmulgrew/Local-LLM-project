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

    async function submitMessage() {
        const result = await controller.submitDraft(elements.messageInput.value);
        if (!result.sent) return;

        view.clearDraftTextIfUnchanged(result.submittedText);
        view.clearFileInput();
        view.updateComposer(controller.getState());
        view.focusMessageInput();
    }

    async function showNewChat() {
        if (!await controller.showNewChat()) return;
        view.clearFileInput();
        view.focusMessageInput();
        view.closeSidebar();
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

    elements.usernameInput.addEventListener("input", () => {
        controller.updateUsernameInput(elements.usernameInput.value);
    });
    elements.usernameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            controller.resolveUsername();
        }
    });
    elements.usernameInput.addEventListener("blur", () => {
        controller.resolveUsername();
    });
    elements.newChatButton.addEventListener("click", showNewChat);
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
                if (selected) view.closeSidebar();
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
                if (selected) view.closeSidebar();
            });
        }
    });
    elements.composer.addEventListener("submit", (event) => {
        event.preventDefault();
        submitMessage();
    });
    elements.messageInput.addEventListener("input", () => {
        view.updateComposer(controller.getState());
    });
    elements.messageInput.addEventListener("keydown", (event) => {
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
    elements.menuButton.addEventListener("click", view.toggleSidebar);
    elements.sidebarScrim.addEventListener("click", view.closeSidebar);
    window.addEventListener("beforeunload", controller.dispose);

    const initialState = controller.getState();
    view.setUsernameInput(initialState.usernameInput);
    view.render(initialState);
    if (initialState.usernameInput.trim()) {
        controller.resolveUsername();
    } else {
        view.renderStatus("connecting", "Enter a username");
    }
})();