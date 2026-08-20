from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable, AsyncGenerator
from contextlib import asynccontextmanager

import aiomysql
import httpx
from fastapi import FastAPI

from L3M_Web.config.settings import Settings
from L3M_Web.infrastructure.database import (
    close_pool,
    create_pool,
)
from L3M_Web.infrastructure.ollama import (
    close_client,
    create_client,
)

logger = logging.getLogger(__name__)

Lifespan = Callable[[FastAPI], AsyncGenerator[None]]


def create_lifespan(settings: Settings) -> Lifespan:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        db_pool: aiomysql.Pool | None = None
        ollama_client: httpx.AsyncClient | None = None

        logger.info("Starting %s", settings.app_name)

        try:
            db_pool = await create_pool(settings)
            ollama_client = create_client(settings)

            app.state.db_pool = db_pool
            app.state.ollama_client = ollama_client

            yield
        finally:
            logger.info("Stopping %s", settings.app_name)

            # Close resources in reverse creation order.
            if ollama_client is not None:
                await close_client(ollama_client)

            if db_pool is not None:
                await close_pool(db_pool)

    return lifespan