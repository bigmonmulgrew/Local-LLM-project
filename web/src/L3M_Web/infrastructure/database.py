from __future__ import annotations

import logging

import aiomysql

from L3M_Web.config.settings import Settings

logger = logging.getLogger(__name__)

async def create_pool(settings: Settings) -> aiomysql.Pool:
    logger.info("Creating MySQL connection pool")

    pool = await aiomysql.create_pool(
        host=settings.db_host,
        port=settings.db_port,
        user=settings.mysql_user,
        password=settings.mysql_password.get_secret_value(),
        db=settings.mysql_database,
        minsize=1,
        maxsize=5,
        autocommit=True,
        connect_timeout=10,
    )

    logger.info("MySQL connection pool is ready")
    return pool


async def close_pool(pool: aiomysql.Pool) -> None:
    logger.info("Closing MySQL connection pool")

    pool.close()
    await pool.wait_closed()

    logger.info("MySQL connection pool closed")


async def is_mysql_ready(pool: aiomysql.Pool | None) -> bool:
    if pool is None:
        return False

    try:
        async with pool.acquire() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("SELECT 1")
                row = await cursor.fetchone()

        return row == (1,)
    except Exception:
        logger.warning("MySQL readiness check failed", exc_info=True)
        return False