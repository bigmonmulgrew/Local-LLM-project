from __future__ import annotations

import logging

import uvicorn

from l3m_ai.app_factory import create_app
from l3m_ai.settings import Settings


settings = Settings()
app = create_app(settings)


def main() -> None:
    """Start the AI proxy using its environment-backed settings."""

    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    uvicorn.run(
        app,
        host=settings.ai_host,
        port=settings.ai_port,
        access_log=False,
        log_config=None,
    )


if __name__ == "__main__":
    main()
