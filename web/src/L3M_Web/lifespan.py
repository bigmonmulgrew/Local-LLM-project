from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncEngine

from L3M_Web.api.services.attachment_storage import AttachmentStorage
from L3M_Web.config.settings import Settings
from L3M_Web.infrastructure.database import (
    AsyncSessionFactory,
    close_database_engine,
    create_database_engine,
    create_session_factory,
    create_tables,
)
from L3M_Web.infrastructure.ollama import close_client, create_client

logger = logging.getLogger(__name__)


def create_lifespan(settings: Settings):
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        db_engine: AsyncEngine | None = None
        ollama_client: httpx.AsyncClient | None = None
        session_factory: AsyncSessionFactory | None = None

        logger.info("Starting %s", settings.app_name)
        try:
            db_engine = create_database_engine(settings)
            session_factory = create_session_factory(db_engine)
            await create_tables(db_engine)
            attachment_storage = AttachmentStorage(settings.upload_directory)
            await attachment_storage.ensure_root()
            ollama_client = create_client(settings)

            app.state.db_engine = db_engine
            app.state.db_session_factory = session_factory
            app.state.ollama_client = ollama_client
            yield
        finally:
            logger.info("Stopping %s", settings.app_name)
            if ollama_client is not None:
                await close_client(ollama_client)
            if db_engine is not None:
                await close_database_engine(db_engine)

    return lifespan