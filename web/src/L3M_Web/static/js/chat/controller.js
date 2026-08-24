/**
 * State and workflow controller for the chat interface.
 *
 * The controller is the only module allowed to mutate application state. It
 * coordinates API calls, ignores stale responses and publishes read-only
 * snapshots for the view to render.
 */

/**
 * @typedef {Object} User
 * @property {string} id Database UUID.
 * @property {string} username Confirmed display name.
 */

/**
 * @typedef {Object} FileObject
 * @property {string} name
 * @property {number} size
 * @property {string} [type]
 */

/**
 * @typedef {Object} Message
 * @property {string} id
 * @property {"user"|"assistant"} role
 * @property {string} content
 * @property {string} created_at
 * @property {FileObject[]} attachments
 */

/**
 * @typedef {Object} ChatSummary
 * @property {string} id
 * @property {string} title
 * @property {string} updated_at
 * @property {string|null} [last_message_preview]
 */

/** @typedef {ChatSummary & {messages: Message[]}} Chat */

/**
 * @typedef {Object} ChatApi
 * @property {(username: string) => Promise<User>} resolveUser
 * @property {(userId: string) => Promise<ChatSummary[]>} listChats
 * @property {(userId: string, chatId: string) => Promise<Chat>} getChat
 * @property {(userId: string, title: string) => Promise<Chat>} createChat
 * @property {(userId: string, chatId: string, title: string) => Promise<Chat>} renameChat
 * @property {(userId: string, chatId: string) => Promise<unknown>} deleteChat
 * @property {(userId: string, chatId: string, message: {text: string, files: File[]}) => Promise<unknown>} sendMessage
 */

/** @typedef {"connecting"|"ready"|"error"} ConnectionStatus */

/**
 * Immutable state published to the view.
 *
 * @typedef {Object} ChatState
 * @property {string} usernameInput
 * @property {Readonly<User>|null} currentUser
 * @property {ReadonlyArray<Readonly<ChatSummary>>} chatSummaries
 * @property {Readonly<Chat>|null} selectedChat
 * @property {ReadonlyArray<File>} draftAttachments
 * @property {boolean} isSendingMessage
 */

/**
 * @typedef {Object} ChatControllerOptions
 * @property {ChatApi} api
 * @property {Storage} [storage]
 * @property {(state: ChatState) => void} [onStateChange]
 * @property {(status: ConnectionStatus, message: string) => void} [onStatusChange]
 * @property {Pick<Console, "error">} [logger]
 * @property {number} [usernameConfirmationDelay]
 * @property {typeof setTimeout} [setTimer]
 * @property {typeof clearTimeout} [clearTimer]
 */

/**
 * @typedef {Object} SubmitDraftResult
 * @property {boolean} sent
 * @property {string} submittedText
 */

const USERNAME_STORAGE_KEY = "l3m-chat-username";
const LEGACY_CHAT_STORAGE_KEY = "l3m-chat-prototype-v1";

/** @returns {void} */
function noOperation() {}

/** @template T @param {T|null} record @returns {Readonly<T>|null} */
function freezeRecord(record) {
    return record ? Object.freeze({ ...record }) : null;
}

/** @param {Chat|null} chat @returns {Readonly<Chat>|null} */
function freezeChat(chat) {
    if (!chat) return null;
    const messages = (chat.messages || []).map((message) => Object.freeze({
        ...message,
        attachments: Object.freeze(
            (message.attachments || []).map((file) => Object.freeze({ ...file }))
        )
    }));

    return Object.freeze({
        ...chat,
        messages: Object.freeze(messages)
    });
}

/**
 * Create the stateful workflow boundary used by the browser entry point.
 *
 * @param {ChatControllerOptions} options
 */
export function createChatController({
    api,
    storage = globalThis.localStorage,
    onStateChange = noOperation,
    onStatusChange = noOperation,
    logger = globalThis.console,
    usernameConfirmationDelay = 5000,
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout
}) {
    if (!api) throw new TypeError("A chat API client is required");

    // Conversation data belongs to the server. The username is the only local
    // preference because it is needed to restore the user's view after reload.
    const savedUsername = storage.getItem(USERNAME_STORAGE_KEY) || "";
    storage.removeItem(LEGACY_CHAT_STORAGE_KEY);

    /** @type {{usernameInput: string, currentUser: User|null, chatSummaries: ChatSummary[], selectedChat: Chat|null, draftAttachments: File[], isSendingMessage: boolean}} */
    const state = {
        usernameInput: savedUsername,
        currentUser: null,
        chatSummaries: [],
        selectedChat: null,
        draftAttachments: [],
        isSendingMessage: false
    };

    /** @type {ReturnType<typeof setTimeout>|null} */
    let usernameConfirmationTimerId = null;
    let usernameRevision = 0;
    /** @type {{username: string, revision: number, promise: Promise<User|null>}|null} */
    let usernameConfirmation = null;

    // Version counters make response order explicit. A request may finish
    // successfully yet still be obsolete after the user changes identity or
    // selects another chat, so obsolete results are discarded before mutation.
    let chatListRequestVersion = 0;
    let chatSelectionRequestVersion = 0;

    /** @returns {Readonly<ChatState>} */
    function getState() {
        return Object.freeze({
            ...state,
            currentUser: freezeRecord(state.currentUser),
            chatSummaries: Object.freeze(
                state.chatSummaries.map((chat) => freezeRecord(chat))
            ),
            selectedChat: freezeChat(state.selectedChat),
            draftAttachments: Object.freeze([...state.draftAttachments])
        });
    }

    /** @returns {void} */
    function publishState() {
        onStateChange(getState());
    }

    /** @param {ConnectionStatus} status @param {string} message */
    function publishStatus(status, message) {
        onStatusChange(status, message);
    }

    /** @returns {void} */
    function invalidateChatRequests() {
        chatListRequestVersion += 1;
        chatSelectionRequestVersion += 1;
    }

    /** @returns {void} */
    function cancelUsernameTimer() {
        if (usernameConfirmationTimerId !== null) {
            clearTimer(usernameConfirmationTimerId);
            usernameConfirmationTimerId = null;
        }
    }

    /**
     * @param {{preserveSelectedChat?: boolean}} [options]
     * @returns {Promise<boolean>}
     */
    async function loadChatSummaries({ preserveSelectedChat = false } = {}) {
        if (!state.currentUser) return false;

        const userId = state.currentUser.id;
        const requestVersion = ++chatListRequestVersion;
        if (!preserveSelectedChat) state.selectedChat = null;
        publishStatus("connecting", "Loading chats…");

        try {
            const loadedChats = await api.listChats(userId);
            if (
                requestVersion !== chatListRequestVersion
                || state.currentUser?.id !== userId
            ) {
                return false;
            }

            state.chatSummaries = loadedChats;
            publishStatus("ready", "API connected");
            publishState();
            return true;
        } catch (error) {
            if (
                requestVersion !== chatListRequestVersion
                || state.currentUser?.id !== userId
            ) {
                return false;
            }

            state.chatSummaries = [];
            publishStatus("error", "API unavailable");
            publishState();
            logger.error(error);
            return false;
        }
    }

    /** @returns {Promise<User|null>} */
    async function resolveUsername() {
        cancelUsernameTimer();
        const username = state.usernameInput.trim();
        const revision = usernameRevision;
        storage.setItem(USERNAME_STORAGE_KEY, state.usernameInput);

        if (!username) {
            usernameConfirmation = null;
            state.currentUser = null;
            state.chatSummaries = [];
            state.selectedChat = null;
            invalidateChatRequests();
            publishStatus("connecting", "Enter a username");
            publishState();
            return null;
        }

        if (state.currentUser?.username === username) return state.currentUser;

        // Blur, Enter, the idle timer and Send can fire together. Sharing the
        // promise prevents duplicate resolve/create requests for one revision.
        if (
            usernameConfirmation?.username === username
            && usernameConfirmation.revision === revision
        ) {
            return usernameConfirmation.promise;
        }

        publishStatus("connecting", "Confirming username…");
        const promise = (async () => {
            try {
                const user = await api.resolveUser(username);
                if (
                    revision !== usernameRevision
                    || state.usernameInput.trim() !== username
                ) {
                    return null;
                }

                state.currentUser = user;
                state.selectedChat = null;
                chatSelectionRequestVersion += 1;
                await loadChatSummaries();

                if (
                    revision !== usernameRevision
                    || state.usernameInput.trim() !== username
                ) {
                    return null;
                }
                return user;
            } catch (error) {
                if (
                    revision === usernameRevision
                    && state.usernameInput.trim() === username
                ) {
                    state.currentUser = null;
                    state.chatSummaries = [];
                    state.selectedChat = null;
                    publishStatus("error", "Username confirmation failed");
                    publishState();
                    logger.error(error);
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

    /** @param {string} value @returns {void} */
    function updateUsernameInput(value) {
        state.usernameInput = value;
        storage.setItem(USERNAME_STORAGE_KEY, value);
        usernameRevision += 1;
        usernameConfirmation = null;
        state.currentUser = null;
        state.chatSummaries = [];
        state.selectedChat = null;

        // Keep draft text in the DOM and draft files in controller state while
        // identity is unresolved. A user who clicks Send to confirm a new name
        // must not lose the message that triggered confirmation.
        invalidateChatRequests();
        cancelUsernameTimer();

        publishStatus(
            "connecting",
            value.trim() ? "Waiting to confirm…" : "Enter a username"
        );
        publishState();

        if (value.trim()) {
            usernameConfirmationTimerId = setTimer(
                resolveUsername,
                usernameConfirmationDelay
            );
        }
    }

    /** @returns {Promise<User|null>} */
    async function ensureCurrentUser() {
        const username = state.usernameInput.trim();
        if (state.currentUser?.username === username) return state.currentUser;
        return resolveUsername();
    }

    /** @param {string} chatId @returns {Promise<boolean>} */
    async function selectChat(chatId) {
        if (!state.currentUser) return false;

        const userId = state.currentUser.id;
        const requestVersion = ++chatSelectionRequestVersion;
        publishStatus("connecting", "Loading conversation…");

        try {
            const loadedChat = await api.getChat(userId, chatId);
            if (
                requestVersion !== chatSelectionRequestVersion
                || state.currentUser?.id !== userId
            ) {
                return false;
            }

            state.selectedChat = loadedChat;
            publishStatus("ready", "API connected");
            publishState();
            return true;
        } catch (error) {
            if (
                requestVersion !== chatSelectionRequestVersion
                || state.currentUser?.id !== userId
            ) {
                return false;
            }

            publishStatus("error", "Could not load chat");
            logger.error(error);
            return false;
        }
    }

    /**
     * @param {string} chatId
     * @param {string} title
     * @returns {Promise<boolean>}
     */
    async function renameChat(chatId, title) {
        const userId = state.currentUser?.id;
        if (!userId) return false;

        try {
            const updatedChat = await api.renameChat(userId, chatId, title);
            if (state.currentUser?.id !== userId) return false;
            if (state.selectedChat?.id === updatedChat.id) {
                state.selectedChat = updatedChat;
            }
            await loadChatSummaries({ preserveSelectedChat: true });
            return true;
        } catch (error) {
            if (state.currentUser?.id === userId) {
                publishStatus("error", "Rename failed");
                logger.error(error);
            }
            return false;
        }
    }

    /** @param {string} chatId @returns {Promise<boolean>} */
    async function deleteChat(chatId) {
        const userId = state.currentUser?.id;
        if (!userId) return false;

        try {
            await api.deleteChat(userId, chatId);
            if (state.currentUser?.id !== userId) return false;
            if (state.selectedChat?.id === chatId) {
                chatSelectionRequestVersion += 1;
                state.selectedChat = null;
            }
            await loadChatSummaries({ preserveSelectedChat: true });
            return true;
        } catch (error) {
            if (state.currentUser?.id === userId) {
                publishStatus("error", "Delete failed");
                logger.error(error);
            }
            return false;
        }
    }

    /** @param {string} draftText @returns {Promise<SubmitDraftResult>} */
    async function submitDraft(draftText) {
        const content = draftText.trim();
        const submittedFiles = [...state.draftAttachments];
        if (
            state.isSendingMessage
            || (!content && submittedFiles.length === 0)
        ) {
            return { sent: false, submittedText: draftText };
        }

        state.isSendingMessage = true;
        publishState();
        let submittedUserId = null;

        try {
            const user = await ensureCurrentUser();
            if (!user) return { sent: false, submittedText: draftText };
            submittedUserId = user.id;

            let targetChat = state.selectedChat;
            if (!targetChat) {
                const title = content.replace(/[`*_>#]/g, "").slice(0, 42)
                    || "New conversation";
                targetChat = await api.createChat(user.id, title);
                if (state.currentUser?.id === user.id) {
                    state.selectedChat = targetChat;
                    publishState();
                }
            }

            const targetChatId = targetChat.id;
            publishStatus("connecting", "Ollama is responding…");
            await api.sendMessage(user.id, targetChatId, {
                text: content,
                files: submittedFiles
            });

            // Remove only the attachments included in this successful request.
            state.draftAttachments = state.draftAttachments.filter(
                (file) => !submittedFiles.includes(file)
            );

            try {
                const listRequestVersion = ++chatListRequestVersion;
                const [updatedChat, updatedChats] = await Promise.all([
                    api.getChat(user.id, targetChatId),
                    api.listChats(user.id)
                ]);

                if (
                    listRequestVersion === chatListRequestVersion
                    && state.currentUser?.id === user.id
                ) {
                    state.chatSummaries = updatedChats;
                    if (state.selectedChat?.id === targetChatId) {
                        state.selectedChat = updatedChat;
                    }
                    publishStatus("ready", "API connected");
                }
            } catch (refreshError) {
                if (state.currentUser?.id === user.id) {
                    publishStatus("error", "Message sent; refresh failed");
                }
                logger.error(refreshError);
            }

            return { sent: true, submittedText: draftText };
        } catch (error) {
            if (
                submittedUserId === null
                || state.currentUser?.id === submittedUserId
            ) {
                publishStatus("error", "Message failed");
            }
            logger.error(error);
            return { sent: false, submittedText: draftText };
        } finally {
            state.isSendingMessage = false;
            publishState();
        }
    }

    /** @returns {Promise<boolean>} */
    async function showNewChat() {
        if (!await ensureCurrentUser()) return false;
        chatSelectionRequestVersion += 1;
        state.selectedChat = null;
        state.draftAttachments = [];
        publishState();
        return true;
    }

    /** @param {FileList|File[]} files @returns {void} */
    function addDraftAttachments(files) {
        state.draftAttachments.push(...Array.from(files));
        publishState();
    }

    /** @param {number} index @returns {void} */
    function removeDraftAttachment(index) {
        if (!Number.isInteger(index) || index < 0) return;
        state.draftAttachments.splice(index, 1);
        publishState();
    }

    /** Stop timers and invalidate work that may finish after page teardown. */
    function dispose() {
        cancelUsernameTimer();
        usernameRevision += 1;
        usernameConfirmation = null;
        invalidateChatRequests();
    }

    return Object.freeze({
        getState,
        updateUsernameInput,
        resolveUsername,
        loadChatSummaries,
        selectChat,
        renameChat,
        deleteChat,
        submitDraft,
        showNewChat,
        addDraftAttachments,
        removeDraftAttachment,
        dispose
    });
}