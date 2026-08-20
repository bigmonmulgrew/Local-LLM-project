from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from pathlib import Path
from fastapi.templating import Jinja2Templates

import aiomysql
import httpx
from fastapi import FastAPI, Request, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from L3M_Web.config.settings import Settings
from L3M_Web.config.validate import validate_settings, SettingsValidationError
from L3M_Web.config.summary import log_settings_summary
from L3M_Web.config.logging import setup_logging

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

templates = Jinja2Templates(
    directory=BASE_DIR / "templates",
)

# Settings, import, validate then summarise
logger = logging.getLogger(__name__)
settings = Settings()

setup_logging(settings.log_level)

try:
    validate_settings(settings)
except SettingsValidationError as e:
    logger.error("Configuration error: %s", e)
    raise  

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

log_settings_summary(settings)


async def check_mysql(app: FastAPI) -> bool:
    pool: aiomysql.Pool | None = getattr(app.state, "db_pool", None)
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


async def check_ollama() -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{settings.ollama_base_url.rstrip('/')}/api/tags")
        return response.is_success
    except httpx.HTTPError:
        logger.warning("Ollama readiness check failed", exc_info=True)
        return False


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("Starting %s", settings.app_name)
    app.state.db_pool = await aiomysql.create_pool(
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
    try:
        yield
    finally:
        logger.info("Stopping %s", settings.app_name)
        app.state.db_pool.close()
        await app.state.db_pool.wait_closed()
        logger.info("MySQL connection pool closed")


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/", response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    mysql_ready = await check_mysql(request.app)
    ollama_ready = await check_ollama()

    return templates.TemplateResponse(
        request=request,
        name="home.html",
        context={
            "app_name": settings.app_name,
            "ollama_model": settings.ollama_model,
            "mysql": {
                "label": "Ready" if mysql_ready else "Unavailable",
                "css_class": "ok" if mysql_ready else "warn",
            },
            "ollama": {
                "label": "Ready" if ollama_ready else "Unavailable",
                "css_class": "ok" if ollama_ready else "warn",
            },
        },
    )


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz")
async def readyz(request: Request) -> JSONResponse:
    checks = {
        "mysql": await check_mysql(request.app),
        "ollama": await check_ollama(),
    }
    ready = all(checks.values())
    return JSONResponse(
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "ready" if ready else "not ready", "checks": checks},
    )
