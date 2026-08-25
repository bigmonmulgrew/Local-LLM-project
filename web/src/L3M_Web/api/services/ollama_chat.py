from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Literal, NotRequired, TypedDict

import httpx


class OllamaGenerationError(RuntimeError):
    """Raised when Ollama cannot return a usable assistant message."""


class OllamaMessage(TypedDict):
    """One message in Ollama's native chat request format."""

    role: Literal["user", "assistant"]
    content: str
    images: NotRequired[list[str]]


async def stream_chat_response(
    client: httpx.AsyncClient,
    model: str,
    messages: list[OllamaMessage],
) -> AsyncIterator[str]:
    """Yield assistant-content deltas from Ollama's NDJSON chat stream."""

    received_parts: list[str] = []
    try:
        async with client.stream(
            "POST",
            "api/chat",
            json={
                "model": model,
                "messages": messages,
                "stream": True,
            },
            timeout=httpx.Timeout(120.0, connect=5.0),
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                try:
                    payload = json.loads(line)
                    content = payload.get("message", {}).get("content", "")
                except (AttributeError, TypeError, ValueError) as exc:
                    raise OllamaGenerationError(
                        "Ollama returned an invalid stream"
                    ) from exc

                if not isinstance(content, str):
                    raise OllamaGenerationError(
                        "Ollama returned an invalid stream"
                    )
                if content:
                    received_parts.append(content)
                    yield content

                if payload.get("done"):
                    break
    except httpx.HTTPStatusError as exc:
        detail = "Ollama request failed"
        try:
            upstream_detail = exc.response.json().get("error")
            if upstream_detail:
                detail = f"Ollama request failed: {upstream_detail}"
        except (AttributeError, TypeError, ValueError):
            pass
        raise OllamaGenerationError(detail) from exc
    except httpx.HTTPError as exc:
        raise OllamaGenerationError("Ollama request failed") from exc

    if not "".join(received_parts).strip():
        raise OllamaGenerationError("Ollama returned an empty response")
