import asyncio
import json

import httpx

from L3M_Web.api.services.ollama_chat import stream_chat_response
from L3M_Web.infrastructure.ollama import list_ollama_models


def test_chat_response_is_yielded_as_content_deltas() -> None:
    async def run() -> tuple[list[str], dict]:
        captured_request: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured_request.update(json.loads(request.content))
            body = "\n".join((
                json.dumps({
                    "message": {"role": "assistant", "content": "Hel"},
                    "done": False,
                }),
                json.dumps({
                    "message": {"role": "assistant", "content": "lo"},
                    "done": True,
                }),
            ))
            return httpx.Response(200, text=body)

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            base_url="http://ollama/",
        ) as client:
            deltas = [
                delta
                async for delta in stream_chat_response(
                    client,
                    "gemma3:4b",
                    [{"role": "user", "content": "Hello"}],
                )
            ]
        return deltas, captured_request

    deltas, request = asyncio.run(run())
    assert deltas == ["Hel", "lo"]
    assert request["stream"] is True
    assert request["model"] == "gemma3:4b"


def test_installed_models_are_sorted_and_deduplicated() -> None:
    async def run() -> tuple[str, ...]:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={
                "models": [
                    {"name": "llama3.2:3b"},
                    {"name": "gemma3:4b"},
                    {"model": "gemma3:4b"},
                ]
            })

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            base_url="http://ollama/",
        ) as client:
            return await list_ollama_models(client)

    assert asyncio.run(run()) == ("gemma3:4b", "llama3.2:3b")
