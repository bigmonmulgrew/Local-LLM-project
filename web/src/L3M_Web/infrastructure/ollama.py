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


async def list_ollama_models(client: httpx.AsyncClient) -> tuple[str, ...]:
    """Return the installed model names reported by Ollama."""

    try:
        response = await client.get("api/tags", timeout=5.0)
        response.raise_for_status()
        payload = response.json()
        models = payload.get("models", [])
        names = {
            str(model.get("name") or model.get("model") or "").strip()
            for model in models
            if isinstance(model, dict)
        }
        return tuple(sorted(name for name in names if name))
    except (httpx.HTTPError, TypeError, ValueError):
        logger.warning("Could not load the Ollama model list", exc_info=True)
        return ()
