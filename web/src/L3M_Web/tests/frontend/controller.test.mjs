import assert from "node:assert/strict";
import test from "node:test";

import { createChatController } from "../../static/js/chat/controller.js";

function createStorage() {
    const values = new Map();
    return {
        values,
        storage: {
            getItem: (key) => values.get(key) || null,
            setItem: (key, value) => values.set(key, value),
            removeItem: (key) => values.delete(key)
        }
    };
}

function createApi(overrides = {}) {
    return {
        async resolveUser(username) {
            return { id: "user-1", username };
        },
        async listChats() { return []; },
        async getChat(_userId, chatId) {
            return {
                id: chatId,
                title: chatId,
                messages: [],
                updated_at: "2026-08-24T10:00:00.000000"
            };
        },
        async createChat() {
            return {
                id: "chat-1",
                title: "New conversation",
                messages: [],
                updated_at: "2026-08-24T10:00:00.000000"
            };
        },
        async renameChat() { throw new Error("Unexpected renameChat call"); },
        async deleteChat() { throw new Error("Unexpected deleteChat call"); },
        async sendMessage(_userId, _chatId, { text, files, onDelta }) {
            onDelta("Streamed reply");
            return {
                message: {
                    id: "user-message",
                    role: "user",
                    content: text,
                    attachments: files,
                    created_at: "2026-08-24T10:00:00.000001"
                },
                generated_response: {
                    id: "assistant-message",
                    role: "assistant",
                    content: "Streamed reply",
                    attachments: [],
                    created_at: "2026-08-24T10:00:00.000002"
                }
            };
        },
        ...overrides
    };
}

function createController(api, options = {}) {
    const { storage } = createStorage();
    return createChatController({
        api,
        storage,
        onStateChange() {},
        onStatusChange() {},
        logger: { error() {} },
        setTimer: options.setTimer || (() => 1),
        clearTimer: options.clearTimer || (() => {}),
        usernameConfirmationDelay: 5
    });
}

test("simultaneous confirmation triggers share one backend request", async () => {
    let resolveRequests = 0;
    const controller = createController(createApi({
        async resolveUser(username) {
            resolveRequests += 1;
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { id: "user-1", username };
        }
    }));

    controller.updateUsernameInput("Alice");
    const [firstUser, secondUser] = await Promise.all([
        controller.resolveUsername(),
        controller.resolveUsername()
    ]);

    assert.equal(resolveRequests, 1);
    assert.equal(firstUser.id, "user-1");
    assert.equal(secondUser.id, "user-1");
    assert.equal(controller.getState().currentUser.username, "Alice");
});

test("the most recently selected chat wins an out-of-order race", async () => {
    const controller = createController(createApi({
        async getChat(_userId, chatId) {
            await new Promise((resolve) => setTimeout(
                resolve,
                chatId === "chat-a" ? 30 : 5
            ));
            return {
                id: chatId,
                title: chatId === "chat-a" ? "Chat A" : "Chat B",
                messages: [],
                updated_at: "2026-08-24T10:00:00.000000"
            };
        }
    }));

    controller.updateUsernameInput("Alice");
    await controller.resolveUsername();
    await Promise.all([
        controller.selectChat("chat-a"),
        controller.selectChat("chat-b")
    ]);

    assert.equal(controller.getState().selectedChat.id, "chat-b");
});

test("published state cannot mutate controller-owned attachment state", () => {
    const controller = createController(createApi());
    const attachment = new File(["test"], "test.png", {
        type: "image/png"
    });

    controller.addDraftAttachments([attachment]);
    const snapshot = controller.getState();

    assert.throws(
        () => snapshot.draftAttachments.push(new File(["x"], "external.txt")),
        TypeError
    );
    assert.deepEqual(
        controller.getState().draftAttachments.map((file) => file.name),
        ["test.png"]
    );
});

test("a successful send removes only the submitted attachments", async () => {
    let releaseSend;
    let sendStarted = false;
    let sentFiles = [];
    const sendGate = new Promise((resolve) => { releaseSend = resolve; });
    const controller = createController(createApi({
        async sendMessage(_userId, _chatId, { text, files, onDelta }) {
            sentFiles = files;
            onDelta("Working");
            sendStarted = true;
            await sendGate;
            return {
                message: {
                    id: "user-message",
                    role: "user",
                    content: text,
                    attachments: files,
                    created_at: "2026-08-24T10:00:00.000001"
                },
                generated_response: {
                    id: "assistant-message",
                    role: "assistant",
                    content: "Working",
                    attachments: [],
                    created_at: "2026-08-24T10:00:00.000002"
                }
            };
        }
    }));
    const firstFile = new File(["first"], "first.png", { type: "image/png" });
    const laterFile = new File(["later"], "later.webp", { type: "image/webp" });

    controller.updateUsernameInput("Alice");
    await controller.resolveUsername();
    controller.addDraftAttachments([firstFile]);
    const sendPromise = controller.submitDraft("Hello");
    while (!sendStarted) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(
        controller.getState().pendingExchange.assistantContent,
        "Working"
    );
    controller.addDraftAttachments([laterFile]);
    releaseSend();

    const result = await sendPromise;
    assert.equal(result.sent, true);
    assert.deepEqual(sentFiles.map((file) => file.name), ["first.png"]);
    assert.deepEqual(
        controller.getState().draftAttachments.map((file) => file.name),
        ["later.webp"]
    );
    assert.equal(controller.getState().isSendingMessage, false);
});

test("a failed stream removes provisional messages and preserves the draft", async () => {
    const controller = createController(createApi({
        async sendMessage(_userId, _chatId, { onDelta }) {
            onDelta("Partial response");
            throw new Error("stream failed");
        }
    }));
    const attachment = new File(["image"], "retry.png", {
        type: "image/png"
    });

    controller.updateUsernameInput("Alice");
    await controller.resolveUsername();
    controller.addDraftAttachments([attachment]);
    const result = await controller.submitDraft("Please inspect this");

    assert.equal(result.sent, false);
    assert.equal(controller.getState().pendingExchange, null);
    assert.deepEqual(
        controller.getState().draftAttachments.map((file) => file.name),
        ["retry.png"]
    );
});

test("unsupported draft files are rejected before submission", () => {
    const statuses = [];
    const { storage } = createStorage();
    const controller = createChatController({
        api: createApi(),
        storage,
        onStateChange() {},
        onStatusChange: (...status) => statuses.push(status),
        logger: { error() {} }
    });

    controller.addDraftAttachments([
        new File(["text"], "notes.txt", { type: "text/plain" }),
        new File(["image"], "photo.jpg", { type: "image/jpeg" })
    ]);

    assert.deepEqual(
        controller.getState().draftAttachments.map((file) => file.name),
        ["photo.jpg"]
    );
    assert.match(statuses.at(-1)[1], /JPEG, PNG and WebP/);
});

test("keyboard and model preferences are validated and persisted", () => {
    const { storage, values } = createStorage();
    const controller = createChatController({
        api: createApi(),
        storage,
        initialModels: ["gemma3:4b", "llama3.2:3b"],
        defaultModel: "gemma3:4b"
    });

    controller.updateEnterToSend(false);
    assert.equal(controller.selectModel("llama3.2:3b"), true);
    assert.equal(controller.selectModel("unknown"), false);
    assert.equal(controller.getState().enterToSend, false);
    assert.equal(controller.getState().selectedModel, "llama3.2:3b");
    assert.equal(values.get("l3m-enter-to-send"), "false");
    assert.equal(values.get("l3m-selected-model"), "llama3.2:3b");
});

test("typing resets the delayed username confirmation timer", () => {
    const callbacks = [];
    const clearedTimers = [];
    const controller = createController(createApi(), {
        setTimer(callback) {
            callbacks.push(callback);
            return callbacks.length;
        },
        clearTimer(timerId) {
            clearedTimers.push(timerId);
        }
    });

    controller.updateUsernameInput("A");
    controller.updateUsernameInput("Al");

    assert.equal(callbacks.length, 2);
    assert.deepEqual(clearedTimers, [1]);
});
