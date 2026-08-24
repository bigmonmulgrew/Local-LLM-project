from __future__ import annotations

import logging

from sqlalchemy import URL, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from L3M_Web.config.settings import Settings
from L3M_Web.database.base import Base

logger = logging.getLogger(__name__)

AsyncSessionFactory = async_sessionmaker[AsyncSession]


def create_database_url(settings: Settings) -> URL:
    return URL.create(
        drivername="mysql+aiomysql",
        username=settings.mysql_user,
        password=settings.mysql_password.get_secret_value(),
        host=settings.db_host,
        port=settings.db_port,
        database=settings.mysql_database,
    )


def create_database_engine(settings: Settings) -> AsyncEngine:
    logger.info("Creating SQLAlchemy async engine")
    return create_async_engine(
        create_database_url(settings),
        pool_size=5,
        max_overflow=5,
        pool_pre_ping=True,
        pool_recycle=1800,
    )


def create_session_factory(engine: AsyncEngine) -> AsyncSessionFactory:
    return async_sessionmaker(
        bind=engine,
        expire_on_commit=False,
        autoflush=False,
    )


async def create_tables(engine: AsyncEngine) -> None:
    # Importing the model module registers every mapped table on Base.metadata.
    from L3M_Web.database import models  # noqa: F401

    logger.info("Creating missing database tables")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    logger.info("Database tables are ready")


async def close_database_engine(engine: AsyncEngine) -> None:
    logger.info("Disposing SQLAlchemy async engine")
    await engine.dispose()


async def is_mysql_ready(engine: AsyncEngine | None) -> bool:
    if engine is None:
        return False
    try:
        async with engine.connect() as connection:
            result = await connection.execute(text("SELECT 1"))
            return result.scalar_one() == 1
    except Exception:
        logger.warning("MySQL readiness check failed", exc_info=True)
        return False