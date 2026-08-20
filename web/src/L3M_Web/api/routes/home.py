from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from L3M_Web.api.dependencies import (
    DatabasePoolDependency,
    OllamaClientDependency,
    SettingsDependency,
    TemplatesDependency,
)
from L3M_Web.infrastructure.database import is_mysql_ready
from L3M_Web.infrastructure.ollama import is_ollama_ready

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
async def home(
    request: Request,
    settings: SettingsDependency,
    templates: TemplatesDependency,
    db_pool: DatabasePoolDependency,
    ollama_client: OllamaClientDependency,
) -> HTMLResponse:
    mysql_ready = await is_mysql_ready(db_pool)
    ollama_ready = await is_ollama_ready(ollama_client)

    return templates.TemplateResponse(
        request=request,
        name="home.html",
        context={
            "app_name": settings.app_name,
            "ollama_model": settings.ollama_model,
            "mysql": {
                "label": ( "Ready" if mysql_ready else "Unavailable" ),
                "css_class": ( "ok" if mysql_ready else "warn" )
            },
            "ollama": {
                "label": ( "Ready" if ollama_ready else "Unavailable" ),
                "css_class": ( "ok" if ollama_ready else "warn" )
            },
        },
    )