from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Annotated

import httpx
from fastapi import Depends, HTTPException, Request, status
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from L3M_Web.config.settings import Settings
from L3M_Web.infrastructure.database import AsyncSessionFactory

def get_settings(request: Request) -> Settings:
    return request.app.state.settings

def get_templates(request: Request) -> Jinja2Templates:
    return request.app.state.templates

def get_db_engine(request: Request) -> AsyncEngine | None:
    return getattr(request.app.state, "db_engine", None)

def get_ollama_client(request: Request) -> httpx.AsyncClient | None:
    return getattr(request.app.state, "ollama_client", None)

def get_ollama_models(request: Request) -> tuple[str, ...]:
    return getattr(request.app.state, "ollama_models", ())

async def get_db_session(request: Request) -> AsyncGenerator[AsyncSession, None]:
    session_factory: AsyncSessionFactory | None = getattr(
        request.app.state,
        "db_session_factory",
        None,
    )
    if session_factory is None:
        raise HTTPException( status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database is not available" )

    async with session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise

SettingsDependency          = Annotated[Settings, Depends(get_settings)]
TemplatesDependency         = Annotated[Jinja2Templates, Depends(get_templates)]
DatabaseEngineDependency    = Annotated[AsyncEngine | None, Depends(get_db_engine)]
DatabaseSessionDependency   = Annotated[AsyncSession, Depends(get_db_session)]
OllamaClientDependency      = Annotated[httpx.AsyncClient | None, Depends(get_ollama_client)]
OllamaModelsDependency      = Annotated[tuple[str, ...], Depends(get_ollama_models)]

# Transitional alias so existing health/home routes continue to work while
# their argument names are updated from db_pool to db_engine.
DatabasePoolDependency = DatabaseEngineDependency
