import logging
from rich.logging import RichHandler


def setup_logging(level: str = "INFO", *, enable_rich: bool = True,) -> None:
    """
    Configure global logging for DerbyGPT.

    This should be called exactly once at startup.
    """

    log_level = level.upper()

    handlers: list[logging.Handler]

    if enable_rich:
        handlers = [
            RichHandler(
                rich_tracebacks=True,
                show_time=True,
                show_level=True,
                show_path=False,
            )
        ]
    else:
        handlers = [logging.StreamHandler()]

    logging.basicConfig(
        level=log_level,
        format="%(message)s",
        datefmt="[%X]",
        handlers=handlers,
        force=True,  # IMPORTANT: overrides any existing logging config
    )

    # Reduce noise from chatty libraries
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("asyncio").setLevel(logging.WARNING)
