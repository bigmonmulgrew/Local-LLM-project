from __future__ import annotations

from typing import Literal

from fastapi import FastAPI, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from l3m_ai.proxy import PROXY_METHODS, proxy_request


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


def register_routes(app: FastAPI) -> None:
    """Register the AI service's health, chat and passthrough routes."""

    @app.get("/healthz", include_in_schema=False)
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/chat")
    async def chat(request: Request):
        body = await request.body()

        try:
            chat_request = ChatRequest.model_validate_json(body)
            route_kind = "chat-valid"
        except (ValidationError, ValueError):
            # An unrecognised chat contract still belongs to Ollama. Validation
            # only decides whether this layer is able to process the request.
            route_kind = "chat-passthrough"
        else:
            # -----------------------------------------------------------------
            # AI PROCESSING EXTENSION POINT
            #
            # This is where a future implementation can inspect or change a
            # validated chat request before it is sent to Ollama. For example:
            #
            # chat_request.messages = await apply_guardrails(chat_request.messages)
            # chat_request.model = choose_model(chat_request)
            # body = chat_request.model_dump_json(exclude_none=True).encode()
            #
            # Queuing, rate limiting and dynamic upstream selection can also be
            # introduced around this point. The current no-op implementation
            # deliberately leaves `body` untouched so Ollama receives the exact
            # request bytes supplied by the caller.
            # -----------------------------------------------------------------
            pass

        return await proxy_request(request, route_kind=route_kind, body=body)

    @app.api_route("/", methods=PROXY_METHODS)
    async def passthrough_root(request: Request):
        return await proxy_request(request, route_kind="passthrough")

    @app.api_route("/{path:path}", methods=PROXY_METHODS)
    async def passthrough(request: Request, path: str):
        del path
        return await proxy_request(request, route_kind="passthrough")
