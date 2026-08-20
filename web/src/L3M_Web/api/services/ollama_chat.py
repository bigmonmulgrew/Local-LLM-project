from __future__ import annotations

from typing import Any

import httpx


class OllamaGenerationError(RuntimeError):
    """Raised when Ollama cannot return a usable assistant message."""


async def generate_chat_response(
    client: httpx.AsyncClient,
    model: str,
    messages: list[dict[str, Any]],
) -> str:
    try:
        response = await client.post(
            "api/chat",
            json={
                "model": model,
                "messages": messages,
                "stream": False,
            },
            timeout=httpx.Timeout(120.0, connect=5.0),
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise OllamaGenerationError("Ollama request failed") from exc

    try:
        content = response.json()["message"]["content"].strip()
    except (KeyError, TypeError, ValueError) as exc:
        raise OllamaGenerationError("Ollama returned an invalid response") from exc

    if not content:
        raise OllamaGenerationError("Ollama returned an empty response")
    return content