import assert from "node:assert/strict";
import test from "node:test";

import { createChatView } from "../../static/js/chat/view.js";

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