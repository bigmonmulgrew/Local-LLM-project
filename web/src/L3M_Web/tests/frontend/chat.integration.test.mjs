import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { createChatApi } from "../../static/js/chat/api.js";
import { createChatController } from "../../static/js/chat/controller.js";
import { createChatView } from "../../static/js/chat/view.js";

class FakeElement {
    constructor() {
        this.listeners = new Map();
        this.value = "";
        this.files = [];
        this.options = [];
        this.checked = true;
        this.dataset = {};
        this.style = {};
        this.innerHTML = "";
        this._textContent = "";
        this.classList = {
            add() {},
            remove() {},
            toggle() { return true; }
        };
        this.scrollHeight = 20;
        this.children = [];
    }

    addEventListener(type, callback) {
        const callbacks = this.listeners.get(type) || [];
        callbacks.push(callback);
        this.listeners.set(type, callbacks);
    }

    dispatch(type, event = {}) {
        event.preventDefault ||= () => {};
        event.stopPropagation ||= () => {};
        event.target ||= this;
        for (const callback of this.listeners.get(type) || []) callback(event);
    }

    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    focus() {}
    set textContent(value) {
        this._textContent = String(value);
        this.innerHTML = String(value);
    }
    get textContent() { return this._textContent; }
}

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" }
    });
}

function streamResponse(events) {
    return new Response(
        events.map((event) => JSON.stringify(event)).join("\n") + "\n",
        {
            status: 201,
            headers: { "Content-Type": "application/x-ndjson" }
        }
    );
}

function chatRecord(id, title, messages = []) {
    return {
        id,
        user_id: "user-1",
        user: "Alice",
        title,
        created_at: "2026-08-24T10:00:00.000000",
        updated_at: "2026-08-24T10:00:00.000001",
        messages
    };
}

function chatClickTarget(chatId) {
    return {
        closest(selector) {
            if (selector === "[data-chat-id]") {
                return { dataset: { chatId } };
            }
            return null;
        }
    };
}

test("blur plus Send resolves once, preserves files and ignores stale chat", async () => {
    const modelSelect = new FakeElement();
    modelSelect.options = [{ value: "gemma3:4b" }];
    modelSelect.value = "gemma3:4b";
    modelSelect.dataset.defaultModel = "gemma3:4b";
    const selectors = new Map([
        ["[data-chat-app]", new FakeElement()],
        ["#username", new FakeElement()],
        ["[data-new-chat]", new FakeElement()],
        ["[data-chat-list]", new FakeElement()],
        ["[data-chat-count]", new FakeElement()],
        ["[data-chat-title]", new FakeElement()],
        ["[data-chat-meta]", new FakeElement()],
        ["[data-messages]", new FakeElement()],
        ["[data-composer]", new FakeElement()],
        ["[data-message-input]", new FakeElement()],
        ["[data-send-button]", new FakeElement()],
        ["[data-model-select]", modelSelect],
        ["[data-enter-toggle]", new FakeElement()],
        ["[data-format-hint]", new FakeElement()],
        ["[data-file-input]", new FakeElement()],
        ["[data-attachment-list]", new FakeElement()],
        ["[data-menu-button]", new FakeElement()],
        ["[data-sidebar-scrim]", new FakeElement()],
        ["[data-api-status]", new FakeElement()],
        ["[data-api-status-wrap]", new FakeElement()]
    ]);
    const storage = new Map();
    let resolveRequests = 0;
    let messageRequests = 0;
    let submittedFileCount = 0;

    async function fetchMock(path, options = {}) {
        const method = options.method || "GET";
        if (path === "/api/users/resolve") {
            resolveRequests += 1;
            await new Promise((resolve) => setTimeout(resolve, 20));
            return jsonResponse({ id: "user-1", username: "Alice" });
        }
        if (path === "/api/chats" && method === "POST") {
            return jsonResponse(chatRecord("chat-1", "Hello"));
        }
        if (path.includes("/messages") && method === "POST") {
            messageRequests += 1;
            submittedFileCount = options.body.getAll("files").length;
            return streamResponse([
                { type: "delta", content: "Hi" },
                {
                    type: "complete",
                    result: {
                        message: {
                            id: "message-1",
                            role: "user",
                            content: "Hello",
                            attachments: [],
                            created_at: "2026-08-24T10:00:00.000000"
                        },
                        generated_response: {
                            id: "message-2",
                            role: "assistant",
                            content: "Hi",
                            attachments: [],
                            created_at: "2026-08-24T10:00:00.000001"
                        }
                    }
                }
            ]);
        }
        if (path.startsWith("/api/chats/chat-a")) {
            await new Promise((resolve) => setTimeout(resolve, 30));
            return jsonResponse(chatRecord("chat-a", "Chat A"));
        }
        if (path.startsWith("/api/chats/chat-b")) {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return jsonResponse(chatRecord("chat-b", "Chat B"));
        }
        if (path.startsWith("/api/chats/chat-1")) {
            return jsonResponse(chatRecord("chat-1", "Hello", [{
                id: "message-1",
                role: "user",
                content: "Hello",
                attachments: [],
                created_at: "2026-08-24T10:00:00.000000"
            }]));
        }
        if (path.startsWith("/api/chats?")) return jsonResponse([]);
        throw new Error(`Unexpected request: ${method} ${path}`);
    }

    const fakeDocument = {
        querySelector: (selector) => selectors.get(selector) || null,
        createElement: () => new FakeElement()
    };
    const api = createChatApi(fetchMock);
    const context = {
        console,
        document: fakeDocument,
        window: {
            prompt: () => null,
            alert() {},
            confirm: () => true,
            addEventListener() {}
        },
        localStorage: {
            getItem: (key) => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: (key) => storage.delete(key)
        },
        fetch: fetchMock,
        FormData,
        URLSearchParams,
        Intl,
        Date,
        setTimeout,
        clearTimeout,
        requestAnimationFrame: (callback) => callback(),
        __api: api,
        __createChatController: createChatController,
        __createChatView: () => createChatView(
            fakeDocument,
            (callback) => callback()
        )
    };
    const entryPointUrl = new URL("../../static/js/chat.js", import.meta.url);
    const chatSource = fs.readFileSync(entryPointUrl, "utf8")
        .replace('import { createChatApi } from "./chat/api.js";', "")
        .replace(
            'import { createChatController } from "./chat/controller.js";',
            "const createChatController = globalThis.__createChatController;"
        )
        .replace(
            'import { createChatView } from "./chat/view.js";',
            "const createChatView = globalThis.__createChatView;"
        )
        .replace(
            "const api = createChatApi();",
            "const api = globalThis.__api;"
        );
    vm.runInNewContext(chatSource, context);

    const usernameInput = selectors.get("#username");
    const messageInput = selectors.get("[data-message-input]");
    const fileInput = selectors.get("[data-file-input]");
    const composer = selectors.get("[data-composer]");

    usernameInput.value = "Alice";
    usernameInput.dispatch("input");
    messageInput.value = "Hello";
    fileInput.files = [new File(["test"], "test.png", {
        type: "image/png"
    })];
    fileInput.dispatch("change");

    // Clicking Send moves focus first, so blur and submit occur back-to-back.
    usernameInput.dispatch("blur");
    composer.dispatch("submit");
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(resolveRequests, 1);
    assert.equal(messageRequests, 1);
    assert.equal(submittedFileCount, 1);

    const chatList = selectors.get("[data-chat-list]");
    chatList.dispatch("click", { target: chatClickTarget("chat-a") });
    chatList.dispatch("click", { target: chatClickTarget("chat-b") });
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(
        selectors.get("[data-chat-title]").textContent,
        "Chat B"
    );
});
