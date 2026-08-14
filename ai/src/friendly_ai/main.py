from __future__ import annotations

import asyncio
import logging
import os
import signal
from pathlib import Path


READY_FILE = Path(os.getenv("AI_READY_FILE", "/tmp/ai-ready"))


async def run() -> None:
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger = logging.getLogger("friendly_ai")
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    def request_shutdown(received_signal: signal.Signals) -> None:
        logger.info("Received %s; starting graceful shutdown", received_signal.name)
        stop_event.set()

    for shutdown_signal in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(shutdown_signal, request_shutdown, shutdown_signal)

    logger.info("Starting AI placeholder")
    READY_FILE.touch()
    logger.info("helllo world")

    try:
        await stop_event.wait()
    finally:
        READY_FILE.unlink(missing_ok=True)
        logger.info("AI placeholder stopped cleanly")


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
