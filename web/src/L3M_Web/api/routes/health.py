from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from L3M_Web.api.dependencies import (
    DatabasePoolDependency,
    OllamaClientDependency,
)
from L3M_Web.infrastructure.database import is_mysql_ready
from L3M_Web.infrastructure.ollama import is_ollama_ready

router = APIRouter(
    tags=["health"],
)


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(
    db_pool: DatabasePoolDependency,
    ollama_client: OllamaClientDependency,
) -> JSONResponse:
    checks = {
        "mysql": await is_mysql_ready(db_pool),
        "ollama": await is_ollama_ready(ollama_client),
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