/**
 * HTTP client for the chat backend.
 *
 * This module owns endpoint paths, request encoding and API error parsing. UI
 * workflows should call these domain methods rather than construct requests.
 */

/**
 * @typedef {Object} User
 * @property {string} id Database UUID.
 * @property {string} username Display name confirmed by the backend.
 */

/**
 * @typedef {Object} ChatSummary
 * @property {string} id Database UUID.
 * @property {string} title Conversation title.
 * @property {string} updated_at ISO-8601 timestamp.
 * @property {string|null} [last_message_preview] Most recent message excerpt.
 */

/**
 * @typedef {Object} FileObject
 * @property {string} name Original file name.
 * @property {number} size File size in bytes.
 * @property {string} [type] MIME type when known.
 */

/**
 * @typedef {Object} Message
 * @property {string} id Database UUID.
 * @property {"user"|"assistant"} role Message author.
 * @property {string} content Message body.
 * @property {string} created_at ISO-8601 timestamp.
 * @property {FileObject[]} attachments Attached-file metadata.
 */

/** @typedef {ChatSummary & {messages: Message[]}} Chat */

/**
 * Public operations exposed by the chat backend client.
 *
 * @typedef {Object} ChatApi
 * @property {(username: string) => Promise<User>} resolveUser
 * @property {(userId: string) => Promise<ChatSummary[]>} listChats
 * @property {(userId: string, chatId: string) => Promise<Chat>} getChat
 * @property {(userId: string, title: string) => Promise<Chat>} createChat
 * @property {(userId: string, chatId: string, title: string) => Promise<Chat>} renameChat
 * @property {(userId: string, chatId: string) => Promise<null>} deleteChat
 * @property {(userId: string, chatId: string, message: {text: string, files?: File[]}) => Promise<unknown>} sendMessage
 */

/** Error returned for a non-successful API response. */
export class ApiError extends Error {
    /**
     * @param {{method: string, path: string, status: number, detail: string}} details
     */
    constructor({ method, path, status, detail }) {
        super(`${method} ${path}: ${detail}`);
        this.name = "ApiError";
        this.method = method;
        this.path = path;
        this.status = status;
        this.detail = detail;
    }
}

/** @param {Response} response @returns {Promise<string>} */
async function readErrorDetail(response) {
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("json")) {
        const body = await response.json().catch(() => null);
        if (typeof body?.detail === "string") return body.detail;
        if (body?.detail != null) return JSON.stringify(body.detail);
        if (body != null) return JSON.stringify(body);
    } else {
        const body = await response.text().catch(() => "");
        if (body.trim()) return body.trim();
    }

    return `Request failed with status ${response.status}`;
}

/** @param {string} path @param {string} userId @returns {string} */
function userPath(path, userId) {
    const query = new URLSearchParams({ user_id: userId });
    return `${path}?${query}`;
}

/** @param {string} chatId @returns {string} */
function chatPath(chatId) {
    return `/api/chats/${encodeURIComponent(chatId)}`;
}

/**
 * Create a chat API client.
 *
 * Accepting a fetch implementation keeps the transport independently
 * testable without changing application code.
 *
 * @param {typeof fetch} [fetchImplementation]
 * @returns {Readonly<ChatApi>}
 */
export function createChatApi(
    fetchImplementation = (...arguments_) => globalThis.fetch(...arguments_)
) {
    if (typeof fetchImplementation !== "function") {
        throw new TypeError("A fetch implementation is required");
    }

    /**
     * @param {string} path
     * @param {RequestInit} [options]
     * @returns {Promise<any>}
     */
    async function request(path, options = {}) {
        const method = options.method || "GET";
        const headers = new Headers(options.headers);

        // Setting Content-Type manually for FormData would omit the generated
        // multipart boundary and make uploaded files unreadable by the server.
        if (options.body != null && !(options.body instanceof FormData)) {
            if (!headers.has("Content-Type")) {
                headers.set("Content-Type", "application/json");
            }
        }

        const response = await fetchImplementation(path, {
            ...options,
            headers
        });

        if (!response.ok) {
            throw new ApiError({
                method,
                path,
                status: response.status,
                detail: await readErrorDetail(response)
            });
        }

        if (response.status === 204) return null;
        return response.json();
    }

    return Object.freeze({
        resolveUser(username) {
            return request("/api/users/resolve", {
                method: "POST",
                body: JSON.stringify({ username })
            });
        },

        listChats(userId) {
            return request(userPath("/api/chats", userId));
        },

        getChat(userId, chatId) {
            return request(userPath(chatPath(chatId), userId));
        },

        createChat(userId, title) {
            return request("/api/chats", {
                method: "POST",
                body: JSON.stringify({ user_id: userId, title })
            });
        },

        renameChat(userId, chatId, title) {
            return request(chatPath(chatId), {
                method: "PATCH",
                body: JSON.stringify({ user_id: userId, title })
            });
        },

        deleteChat(userId, chatId) {
            return request(userPath(chatPath(chatId), userId), {
                method: "DELETE"
            });
        },

        sendMessage(userId, chatId, { text, files = [] }) {
            const body = new FormData();
            body.append("user_id", userId);
            body.append("role", "user");
            body.append("text", text);
            files.forEach((file) => body.append("files", file, file.name));

            return request(`${chatPath(chatId)}/messages`, {
                method: "POST",
                body
            });
        }
    });
}