from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from l3m_ai.routes import register_routes
from l3m_ai.settings import Settings


logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    """Create the AI proxy application and its shared Ollama client."""

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
    register_routes(app)
    return app
