/**
 * HTTP client for the chat backend.
 *
 * This module owns endpoint paths, request encoding and API error parsing. UI
 * workflows should call these domain methods rather than construct requests.
 */

/** Error returned for a non-successful API response. */
export class ApiError extends Error {
    constructor({ method, path, status, detail }) {
        super(`${method} ${path}: ${detail}`);
        this.name = "ApiError";
        this.method = method;
        this.path = path;
        this.status = status;
        this.detail = detail;
    }
}

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

function userPath(path, userId) {
    const query = new URLSearchParams({ user_id: userId });
    return `${path}?${query}`;
}

function chatPath(chatId) {
    return `/api/chats/${encodeURIComponent(chatId)}`;
}

/**
 * Create a chat API client.
 *
 * Accepting a fetch implementation keeps the transport independently
 * testable without changing application code.
 */
export function createChatApi(
    fetchImplementation = (...arguments_) => globalThis.fetch(...arguments_)
) {
    if (typeof fetchImplementation !== "function") {
        throw new TypeError("A fetch implementation is required");
    }

    async function request(path, options = {}) {
        const method = options.method || "GET";
        const headers = new Headers(options.headers);

        // The browser must supply the multipart boundary for FormData bodies.
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

        listChats(userId)       { return request(userPath("/api/chats", userId)); },

        getChat(userId, chatId) { return request(userPath(chatPath(chatId), userId)); },

        createChat(userId, title) {
            return request("/api/chats",     { method: "POST", body: JSON.stringify({ user_id: userId, title }) });
        },

        renameChat(userId, chatId, title) {
            return request(chatPath(chatId), { method: "PATCH", body: JSON.stringify({ user_id: userId, title }) });
        },

        deleteChat(userId, chatId) {
            return request(userPath(chatPath(chatId), userId), { method: "DELETE" });
        },

        sendMessage(userId, chatId, { text, files = [] }) {
            const body = new FormData();
            body.append("user_id", userId);
            body.append("role", "user");
            body.append("text", text);
            files.forEach((file) => body.append("files", file, file.name));

            return request(`${chatPath(chatId)}/messages`, { method: "POST", body });
        }
    });
}