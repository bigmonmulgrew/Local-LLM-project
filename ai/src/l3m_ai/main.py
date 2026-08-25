from __future__ import annotations

import logging
import time
from collections.abc import AsyncGenerator, AsyncIterable, Iterable
from contextlib import asynccontextmanager
from typing import Literal

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


logger = logging.getLogger("l3m_ai.proxy")

PROXY_METHODS = [
    "DELETE",
    "GET",
    "HEAD",
    "OPTIONS",
    "PATCH",
    "POST",
    "PUT",
    "TRACE",
]
HOP_BY_HOP_HEADERS = {
    b"connection",
    b"keep-alive",
    b"proxy-authenticate",
    b"proxy-authorization",
    b"proxy-connection",
    b"te",
    b"trailer",
    b"transfer-encoding",
    b"upgrade",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False)

    log_level: str = "INFO"
    ai_host: str = "0.0.0.0"
    ai_port: int = Field(default=8000, ge=1, le=65535)
    ollama_base_url: str = "http://ollama:11434"


class ChatMessage(BaseModel):
    """The part of an Ollama chat message the processing layer understands."""

    model_config = ConfigDict(extra="allow", strict=True)

    role: Literal["system", "user", "assistant", "tool"]
    content: str
    images: list[str] | None = None


class ChatRequest(BaseModel):
    """Minimum Ollama chat contract needed by future processing hooks."""

    model_config = ConfigDict(extra="allow", strict=True)

    model: str = Field(min_length=1)
    messages: list[ChatMessage] = Field(min_length=1)
    stream: bool = True


def _filtered_headers(
    raw_headers: Iterable[tuple[bytes, bytes]],
    *,
    remove_host: bool = False,
) -> list[tuple[bytes, bytes]]:
    raw_headers = list(raw_headers)
    connection_tokens: set[bytes] = set()

    for name, value in raw_headers:
        if name.lower() == b"connection":
            connection_tokens.update(
                token.strip().lower() for token in value.split(b",") if token.strip()
            )

    excluded = HOP_BY_HOP_HEADERS | connection_tokens
    if remove_host:
        excluded.add(b"host")

    return [(name, value) for name, value in raw_headers if name.lower() not in excluded]


def _upstream_url(client: httpx.AsyncClient, request: Request) -> httpx.URL:
    raw_path = request.scope.get("raw_path", request.url.path.encode("ascii"))
    query_string = request.scope.get("query_string", b"")
    if query_string:
        raw_path += b"?" + query_string
    return client.base_url.copy_with(raw_path=raw_path)


async def _stream_upstream(
    upstream_response: httpx.Response,
    *,
    method: str,
    path: str,
    route_kind: str,
    started_at: float,
) -> AsyncGenerator[bytes, None]:
    try:
        async for chunk in upstream_response.aiter_raw():
            yield chunk
    finally:
        await upstream_response.aclose()
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        logger.info(
            "%s %s -> %d %s %.0fms",
            method,
            path,
            upstream_response.status_code,
            route_kind,
            elapsed_ms,
        )


async def proxy_request(
    request: Request,
    *,
    route_kind: str,
    body: bytes | None = None,
) -> StreamingResponse | JSONResponse:
    """Forward one HTTP request to Ollama without interpreting its response."""

    started_at = time.perf_counter()
    client: httpx.AsyncClient = request.app.state.ollama_client
    content: bytes | AsyncIterable[bytes] = body if body is not None else request.stream()
    upstream_request = client.build_request(
        method=request.method,
        url=_upstream_url(client, request),
        headers=_filtered_headers(request.headers.raw, remove_host=True),
        content=content,
    )

    try:
        upstream_response = await client.send(upstream_request, stream=True)
    except httpx.RequestError:
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        logger.warning(
            "%s %s -> 502 %s %.0fms",
            request.method,
            request.url.path,
            route_kind,
            elapsed_ms,
        )
        return JSONResponse(
            status_code=502,
            content={"error": "The configured Ollama server is unavailable"},
        )

    response = StreamingResponse(
        _stream_upstream(
            upstream_response,
            method=request.method,
            path=request.url.path,
            route_kind=route_kind,
            started_at=started_at,
        ),
        status_code=upstream_response.status_code,
    )
    response.raw_headers = _filtered_headers(upstream_response.headers.raw)
    return response


def create_app(
    settings: Settings | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    settings = settings or Settings()
    base_url = settings.ollama_base_url.rstrip("/") + "/"

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        timeout = httpx.Timeout(connect=5.0, read=None, write=None, pool=5.0)
        async with httpx.AsyncClient(
            base_url=base_url,
            timeout=timeout,
            transport=transport,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            app.state.ollama_client = client
            logger.info("AI proxy ready: %s", base_url)
            yield

    app = FastAPI(
        title="L3M AI proxy",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    @app.get("/healthz", include_in_schema=False)
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/chat")
    async def chat(request: Request):
        body = await request.body()

        try:
            ChatRequest.model_validate_json(body)
            route_kind = "chat-valid"
        except (ValidationError, ValueError):
            # An unrecognised chat contract still belongs to Ollama. Validation
            # only decides whether this layer is able to process the request.
            route_kind = "chat-passthrough"
        else:
            # AI PROCESSING EXTENSION POINT
            # Guardrails, queuing, message processing, model selection and
            # dynamic upstream routing can be inserted here. Until then, the
            # original bytes are deliberately forwarded without modification.
            pass

        return await proxy_request(request, route_kind=route_kind, body=body)

    @app.api_route("/", methods=PROXY_METHODS)
    async def passthrough_root(request: Request):
        return await proxy_request(request, route_kind="passthrough")

    @app.api_route("/{path:path}", methods=PROXY_METHODS)
    async def passthrough(request: Request, path: str):
        del path
        return await proxy_request(request, route_kind="passthrough")

    return app


settings = Settings()
app = create_app(settings)


def main() -> None:
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    uvicorn.run(
        app,
        host=settings.ai_host,
        port=settings.ai_port,
        access_log=False,
        log_config=None,
    )


if __name__ == "__main__":
    main()
