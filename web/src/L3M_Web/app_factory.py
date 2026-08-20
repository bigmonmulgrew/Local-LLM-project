from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from L3M_Web.api.routes.chat import router as chat_router
from L3M_Web.api.routes.health import router as health_router
from L3M_Web.api.routes.home import router as home_router
from L3M_Web.config.logging import setup_logging
from L3M_Web.config.settings import Settings
from L3M_Web.config.summary import log_settings_summary
from L3M_Web.config.validate import SettingsValidationError, validate_settings
from L3M_Web.lifespan import create_lifespan

PACKAGE_DIR = Path(__file__).resolve().parent
STATIC_DIR = PACKAGE_DIR / "static"
TEMPLATES_DIR = PACKAGE_DIR / "templates"

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create and configure a FastAPI application instance."""
    app_settings = settings or Settings()

    setup_logging(app_settings.log_level)

    try:
        validate_settings(app_settings)
    except SettingsValidationError as exc:
        logger.error("Configuration error: %s", exc)
        raise

    log_settings_summary(app_settings)

    templates = Jinja2Templates(directory=TEMPLATES_DIR)

    app = FastAPI(
        title=app_settings.app_name,
        version="0.1.0",
        lifespan=create_lifespan(app_settings),
    )

    app.state.settings = app_settings
    app.state.templates = templates

    app.mount(
        "/static",
        StaticFiles(directory=STATIC_DIR),
        name="static",
    )

    app.include_router(home_router)
    app.include_router(health_router)
    app.include_router(chat_router)

    return app