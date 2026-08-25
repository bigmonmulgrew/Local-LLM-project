from __future__ import annotations

import logging
import time
from collections.abc import AsyncGenerator, AsyncIterable, Iterable

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse


logger = logging.getLogger(__name__)

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


def filter_headers(
    raw_headers: Iterable[tuple[bytes, bytes]],
    *,
    remove_host: bool = False,
) -> list[tuple[bytes, bytes]]:
    """Remove headers that apply only to one HTTP connection."""

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


def upstream_url(client: httpx.AsyncClient, request: Request) -> httpx.URL:
    """Build the Ollama URL while preserving the encoded path and query string."""

    raw_path = request.scope.get("raw_path", request.url.path.encode("ascii"))
    query_string = request.scope.get("query_string", b"")
    if query_string:
        raw_path += b"?" + query_string
    return client.base_url.copy_with(raw_path=raw_path)


async def stream_upstream(
    upstream_response: httpx.Response,
    *,
    method: str,
    path: str,
    route_kind: str,
    started_at: float,
) -> AsyncGenerator[bytes, None]:
    """Yield the raw Ollama response and close it when streaming ends."""

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
        url=upstream_url(client, request),
        headers=filter_headers(request.headers.raw, remove_host=True),
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
        stream_upstream(
            upstream_response,
            method=request.method,
            path=request.url.path,
            route_kind=route_kind,
            started_at=started_at,
        ),
        status_code=upstream_response.status_code,
    )
    response.raw_headers = filter_headers(upstream_response.headers.raw)
    return response
