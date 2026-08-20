from __future__ import annotations

import logging
import httpx

from L3M_Web.config.settings import Settings

logger = logging.getLogger(__name__)


def create_client(settings: Settings) -> httpx.AsyncClient:
    base_url = settings.ollama_base_url.rstrip("/") + "/"

    return httpx.AsyncClient(base_url=base_url, timeout=httpx.Timeout(2.0))

async def close_client(client: httpx.AsyncClient) -> None:
    await client.aclose()

async def is_ollama_ready(client: httpx.AsyncClient | None) -> bool:
    if client is None:
        return False

    try:
        response = await client.get("api/tags")
        return response.is_success
    except httpx.HTTPError:
        logger.warning("Ollama readiness check failed", exc_info=True)
        return False