from __future__ import annotations

import logging

import aiomysql
import httpx

from L3M_Web.infrastructure.database import is_mysql_ready
from L3M_Web.infrastructure.ollama import is_ollama_ready
from L3M_Web.lifespan import create_lifespan

from pathlib import Path
from fastapi.templating import Jinja2Templates

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


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=create_lifespan(settings),
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/", response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    mysql_ready = await is_mysql_ready(
        get_db_pool(request.app),
    )
    ollama_ready = await is_ollama_ready(
        get_ollama_client(request.app),
    )

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
        "mysql": await is_mysql_ready(get_db_pool(request.app)),
        "ollama": await is_ollama_ready(get_ollama_client(request.app))
    }

    ready = all(checks.values())

    return JSONResponse(
        status_code=(
            status.HTTP_200_OK
            if ready
            else status.HTTP_503_SERVICE_UNAVAILABLE
        ),
        content={
            "status": "ready" if ready else "not ready",
            "checks": checks,
        },
    )

def get_db_pool(app: FastAPI) -> aiomysql.Pool | None:
    return getattr(app.state, "db_pool", None)


def get_ollama_client(app: FastAPI) -> httpx.AsyncClient | None:
    return getattr(app.state, "ollama_client", None)