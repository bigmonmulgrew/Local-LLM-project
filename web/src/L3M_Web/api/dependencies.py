from __future__ import annotations

from typing import Annotated

import aiomysql
import httpx
from fastapi import Depends, Request
from fastapi.templating import Jinja2Templates

from L3M_Web.config.settings import Settings

def get_settings(request: Request) -> Settings:
    return request.app.state.settings

def get_templates(request: Request) -> Jinja2Templates:
    return request.app.state.templates

def get_db_pool(request: Request) -> aiomysql.Pool | None:
    return getattr(request.app.state, "db_pool", None)

def get_ollama_client(request: Request) -> httpx.AsyncClient | None:
    return getattr(request.app.state, "ollama_client", None)

SettingsDependency = Annotated[
    Settings,
    Depends(get_settings),
]

TemplatesDependency = Annotated[
    Jinja2Templates,
    Depends(get_templates),
]

DatabasePoolDependency = Annotated[
    aiomysql.Pool | None,
    Depends(get_db_pool),
]

OllamaClientDependency = Annotated[
    httpx.AsyncClient | None,
    Depends(get_ollama_client),
]