import assert from "node:assert/strict";
import test from "node:test";

import { createChatView } from "../../static/js/chat/view.js";

const REQUIRED_SELECTORS = [
    "[data-chat-app]",
    "#username",
    "[data-new-chat]",
    "[data-chat-list]",
    "[data-chat-count]",
    "[data-chat-title]",
    "[data-chat-meta]",
    "[data-messages]",
    "[data-composer]",
    "[data-message-input]",
    "[data-send-button]",
    "[data-model-select]",
    "[data-enter-toggle]",
    "[data-format-hint]",
    "[data-file-input]",
    "[data-attachment-list]",
    "[data-menu-button]",
    "[data-sidebar-scrim]",
    "[data-api-status]",
    "[data-api-status-wrap]"
];

class FakeElement {
    constructor() {
        this.listeners = new Map();
        this.dataset = {};
        this.style = {};
        this.options = [];
        this.value = "";
        this.scrollHeight = 0;
        this.clientHeight = 0;
        this._scrollTop = 0;
        this.nextScrollHeight = null;
    }

    addEventListener(type, callback) {
        const callbacks = this.listeners.get(type) || [];
        callbacks.push(callback);
        this.listeners.set(type, callbacks);
    }

    dispatch(type) {
        for (const callback of this.listeners.get(type) || []) callback();
    }

    set scrollTop(value) {
        const maximum = Math.max(0, this.scrollHeight - this.clientHeight);
        this._scrollTop = Math.max(0, Math.min(Number(value), maximum));
    }

    get scrollTop() {
        return this._scrollTop;
    }

    replaceChildren() {
        if (this.nextScrollHeight === null) return;
        this.scrollHeight = this.nextScrollHeight;
        this.nextScrollHeight = null;
    }
    setAttribute() {}
    focus() {}
}

function createViewFixture() {
    const elements = new Map(
        REQUIRED_SELECTORS.map((selector) => [selector, new FakeElement()])
    );
    const frames = [];
    const rootDocument = {
        querySelector: (selector) => elements.get(selector) || null,
        createElement: () => new FakeElement()
    };
    const view = createChatView(rootDocument, (callback) => {
        frames.push(callback);
    });
    return { elements, frames, view };
}

function chatState(assistantContent = "Hello") {
    return {
        currentUser: { id: "user-1", username: "Alice" },
        chatSummaries: [],
        selectedChat: {
            id: "chat-1",
            title: "Chat",
            updated_at: "2026-08-24T10:00:00.000000",
            messages: [{
                id: "message-1",
                role: "assistant",
                content: assistantContent,
                attachments: [],
                created_at: "2026-08-24T10:00:00.000000"
            }]
        },
        draftAttachments: [],
        isSendingMessage: false,
        enterToSend: true,
        selectedModel: "",
        pendingExchange: null
    };
}

test("a page without a chat root is ignored", () => {
    assert.equal(createChatView({ querySelector: () => null }), null);
});

test("template drift fails during initialization with a useful error", () => {
    const app = {};
    const documentWithoutUsername = {
        querySelector(selector) {
            return selector === "[data-chat-app]" ? app : null;
        }
    };

    assert.throws(
        () => createChatView(documentWithoutUsername),
        /usernameInput.*#username/
    );
});

test("streamed renders coalesce while the message history stays at the bottom", () => {
    const { elements, frames, view } = createViewFixture();
    const messageHistory = elements.get("[data-messages]");
    messageHistory.scrollHeight = 1000;
    messageHistory.clientHeight = 400;
    messageHistory.scrollTop = 600;

    view.render(chatState("H"));
    view.render(chatState("Hello"));

    assert.equal(frames.length, 1);
    messageHistory.scrollHeight = 1120;
    frames.shift()();
    assert.equal(messageHistory.scrollTop, 720);
});

test("streaming does not scroll a user who has moved above the bottom", () => {
    const { elements, frames, view } = createViewFixture();
    const messageHistory = elements.get("[data-messages]");
    messageHistory.scrollHeight = 1000;
    messageHistory.clientHeight = 400;
    messageHistory.scrollTop = 600;

    view.render(chatState("H"));
    messageHistory.scrollTop = 250;
    messageHistory.dispatch("scroll");
    messageHistory.scrollHeight = 1100;
    frames.shift()();

    assert.equal(messageHistory.scrollTop, 250);
    view.render(chatState("Hello"));
    assert.equal(frames.length, 0);

    messageHistory.scrollTop = 700;
    messageHistory.dispatch("scroll");
    view.render(chatState("Hello again"));
    assert.equal(frames.length, 1);
});

test("a delayed automatic scroll event does not interrupt streaming", () => {
    const { elements, frames, view } = createViewFixture();
    const messageHistory = elements.get("[data-messages]");
    messageHistory.scrollHeight = 1000;
    messageHistory.clientHeight = 400;
    messageHistory.scrollTop = 600;

    messageHistory.nextScrollHeight = 1100;
    view.render(chatState("H"));
    frames.shift()();
    assert.equal(messageHistory.scrollTop, 700);

    messageHistory.nextScrollHeight = 1200;
    view.render(chatState("Hello"));
    messageHistory.dispatch("scroll");
    frames.shift()();

    assert.equal(messageHistory.scrollTop, 800);
});
