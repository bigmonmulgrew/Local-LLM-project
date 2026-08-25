from __future__ import annotations

import asyncio
import logging

import httpx

from l3m_ai.main import Settings, create_app


class AsyncBytes(httpx.AsyncByteStream):
    def __init__(self, content: bytes = b"") -> None:
        self.content = content

    async def __aiter__(self):
        yield self.content


def run(coroutine):
    return asyncio.run(coroutine)


async def request_app(app, method: str, path: str, **kwargs) -> httpx.Response:
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://ai",
        ) as client:
            return await client.request(method, path, **kwargs)


def test_valid_chat_is_forwarded_without_reserializing(caplog) -> None:
    seen: dict[str, object] = {}

    async def upstream(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["url"] = str(request.url)
        seen["body"] = await request.aread()
        seen["header"] = request.headers["x-request-id"]
        return httpx.Response(
            201,
            headers={"content-type": "application/x-ndjson", "x-upstream": "yes"},
            stream=AsyncBytes(b'{"message":{"content":"hello"},"done":true}\n'),
        )

    body = (
        b'{ "model": "gemma3:4b", "messages": '
        b'[{"role":"user","content":"Hello"}], "stream": true, "future": 1 }'
    )
    app = create_app(
        Settings(ollama_base_url="http://ollama:11434"),
        transport=httpx.MockTransport(upstream),
    )

    with caplog.at_level(logging.INFO, logger="l3m_ai.proxy"):
        response = run(
            request_app(
                app,
                "POST",
                "/api/chat?trace=yes",
                content=body,
                headers={"content-type": "application/json", "x-request-id": "abc"},
            )
        )

    assert response.status_code == 201
    assert response.content.endswith(b'"done":true}\n')
    assert response.headers["x-upstream"] == "yes"
    assert seen == {
        "method": "POST",
        "url": "http://ollama:11434/api/chat?trace=yes",
        "body": body,
        "header": "abc",
    }
    assert "chat-valid" in caplog.text


def test_invalid_chat_falls_through_to_ollama(caplog) -> None:
    body = b'{"not":"the expected chat contract"}'

    async def upstream(request: httpx.Request) -> httpx.Response:
        assert await request.aread() == body
        return httpx.Response(
            400,
            headers={"content-type": "application/json"},
            stream=AsyncBytes(b'{"error":"upstream validation"}'),
        )

    app = create_app(transport=httpx.MockTransport(upstream))

    with caplog.at_level(logging.INFO, logger="l3m_ai.proxy"):
        response = run(request_app(app, "POST", "/api/chat", content=body))

    assert response.status_code == 400
    assert response.json() == {"error": "upstream validation"}
    assert "chat-passthrough" in caplog.text


def test_catch_all_preserves_method_path_query_and_body(caplog) -> None:
    async def upstream(request: httpx.Request) -> httpx.Response:
        assert request.method == "PUT"
        assert request.url.path == "/api/blobs/sha256:test"
        assert request.url.query == b"part=1%202"
        assert await request.aread() == b"blob-bytes"
        return httpx.Response(204, stream=AsyncBytes())

    app = create_app(transport=httpx.MockTransport(upstream))

    with caplog.at_level(logging.INFO, logger="l3m_ai.proxy"):
        response = run(
            request_app(
                app,
                "PUT",
                "/api/blobs/sha256:test?part=1%202",
                content=b"blob-bytes",
            )
        )

    assert response.status_code == 204
    assert "passthrough" in caplog.text


def test_catch_all_preserves_percent_encoded_path() -> None:
    async def upstream(request: httpx.Request) -> httpx.Response:
        assert request.url.raw_path == b"/api/example%2Fvalue?raw=%2B"
        return httpx.Response(200, stream=AsyncBytes(b"ok"))

    app = create_app(transport=httpx.MockTransport(upstream))
    response = run(request_app(app, "TRACE", "/api/example%2Fvalue?raw=%2B"))

    assert response.status_code == 200
    assert response.content == b"ok"


def test_health_check_does_not_contact_ollama() -> None:
    async def upstream(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Unexpected upstream request: {request.url}")

    app = create_app(transport=httpx.MockTransport(upstream))
    response = run(request_app(app, "GET", "/healthz"))

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unavailable_ollama_returns_502() -> None:
    async def upstream(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    app = create_app(transport=httpx.MockTransport(upstream))
    response = run(request_app(app, "GET", "/api/tags"))

    assert response.status_code == 502
    assert response.json() == {"error": "The configured Ollama server is unavailable"}
