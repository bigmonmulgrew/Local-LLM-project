import assert from "node:assert/strict";
import test from "node:test";

import {
    ApiError,
    createChatApi
} from "../../static/js/chat/api.js";

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" }
    });
}

test("API client constructs user and chat requests", async () => {
    const calls = [];
    const api = createChatApi(async (path, options = {}) => {
        calls.push({ path, options });
        if (options.method === "DELETE") {
            return new Response(null, { status: 204 });
        }
        return jsonResponse({ ok: true });
    });

    await api.resolveUser("Alice");
    assert.equal(calls.at(-1).path, "/api/users/resolve");
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
        username: "Alice"
    });
    assert.equal(
        calls.at(-1).options.headers.get("Content-Type"),
        "application/json"
    );

    await api.listChats("user-1");
    assert.equal(calls.at(-1).path, "/api/chats?user_id=user-1");

    await api.getChat("user-1", "chat/1");
    assert.equal(
        calls.at(-1).path,
        "/api/chats/chat%2F1?user_id=user-1"
    );

    await api.createChat("user-1", "Research notes");
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
        user_id: "user-1",
        title: "Research notes"
    });

    await api.renameChat("user-1", "chat-1", "Renamed");
    assert.equal(calls.at(-1).options.method, "PATCH");

    await api.deleteChat("user-1", "chat-1");
    assert.equal(calls.at(-1).options.method, "DELETE");
});

test("message uploads leave the FormData boundary to fetch", async () => {
    let messageRequest = null;
    const api = createChatApi(async (path, options = {}) => {
        messageRequest = { path, options };
        return jsonResponse({ ok: true });
    });
    const attachment = new File(["contents"], "notes.txt", {
        type: "text/plain"
    });

    await api.sendMessage("user-1", "chat-1", {
        text: "Summarise this",
        files: [attachment]
    });

    assert.equal(messageRequest.path, "/api/chats/chat-1/messages");
    assert.equal(messageRequest.options.body.get("user_id"), "user-1");
    assert.equal(messageRequest.options.body.get("role"), "user");
    assert.equal(messageRequest.options.body.get("text"), "Summarise this");
    assert.deepEqual(
        messageRequest.options.body.getAll("files").map((file) => file.name),
        ["notes.txt"]
    );
    assert.equal(messageRequest.options.headers.has("Content-Type"), false);
});

test("structured backend failures become useful ApiError objects", async () => {
    const api = createChatApi(async () => jsonResponse({
        detail: [{ loc: ["body", "username"], msg: "Required" }]
    }, 422));

    await assert.rejects(
        () => api.resolveUser(""),
        (error) => {
            assert.equal(error instanceof ApiError, true);
            assert.equal(error.status, 422);
            assert.equal(error.method, "POST");
            assert.match(error.detail, /username/);
            return true;
        }
    );
});