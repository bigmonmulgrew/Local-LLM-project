from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from html import escape

import aiomysql
import httpx
from fastapi import FastAPI, Request, status
from fastapi.responses import HTMLResponse, JSONResponse
from L3M_Web.config.settings import Settings


settings = Settings()
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("hello_web")


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


@app.get("/", response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    mysql_ready = await check_mysql(request.app)
    ollama_ready = await check_ollama()
    mysql_state = "Ready" if mysql_ready else "Unavailable"
    ollama_state = "Ready" if ollama_ready else "Unavailable"
    mysql_class = "ok" if mysql_ready else "warn"
    ollama_class = "ok" if ollama_ready else "warn"
    title = escape(settings.app_name)
    model = escape(settings.ollama_model)
    return HTMLResponse(
        f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    :root {{ color-scheme: light dark; font-family: ui-rounded, system-ui, sans-serif; }}
    body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f3f7ff; color: #172554; }}
    main {{ width: min(680px, calc(100% - 3rem)); padding: 3rem; border-radius: 24px; background: white; box-shadow: 0 18px 50px #1d4ed822; }}
    h1 {{ margin: 0 0 .6rem; font-size: clamp(2.2rem, 8vw, 4.5rem); letter-spacing: -.06em; }}
    p {{ line-height: 1.6; color: #475569; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-top: 2rem; }}
    .card {{ padding: 1rem 1.2rem; border: 1px solid #dbeafe; border-radius: 14px; background: #f8fbff; }}
    .card span {{ display: block; margin-top: .35rem; font-weight: 700; }}
    .ok {{ color: #15803d; }} .warn {{ color: #b45309; }}
    code {{ color: #1d4ed8; }}
    @media (prefers-color-scheme: dark) {{
      body {{ background: #0f172a; color: #e0e7ff; }} main {{ background: #172554; }}
      p {{ color: #cbd5e1; }} .card {{ border-color: #334155; background: #1e293b; }} code {{ color: #93c5fd; }}
    }}
  </style>
</head>
<body>
  <main>
    <h1>Hello, world! 👋</h1>
    <p>Your friendly Python, MySQL, and Ollama MVP is up and running.</p>
    <div class="grid">
      <div class="card">Web API<span class="ok">Ready</span></div>
      <div class="card">MySQL<span class="{mysql_class}">{mysql_state}</span></div>
      <div class="card">Ollama<span class="{ollama_class}">{ollama_state}</span></div>
    </div>
    <p>Configured model: <code>{model}</code> · Try the <a href="/docs">API docs</a>.</p>
  </main>
</body>
</html>"""
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
