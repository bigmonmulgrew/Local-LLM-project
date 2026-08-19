import logging
from L3M_Web.config.settings import Settings

logger = logging.getLogger(__name__)


class SettingsValidationError(RuntimeError):
    """Raised when settings are invalid and DerbyGPT cannot start."""


def validate_settings(settings: Settings) -> None:
    """
    Validate application settings.

    Raises:
        SettingsValidationError: if configuration is invalid
    """
        
    # -------------------------
    # Environment sanity checks
    # -------------------------

    if settings.env not in {"dev", "local", "test", "prod"}:
        logger.warning("Unknown ENV value '%s'", settings.env)
        
    # -------------------------
    # Log-level sanity check
    # -------------------------

    valid_log_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
    if settings.log_level.upper() not in valid_log_levels:
        raise SettingsValidationError(
            f"Invalid LOG_LEVEL '{settings.log_level}'. "
            f"Expected one of {sorted(valid_log_levels)}"
        )

    logger.debug("Settings validation passed")