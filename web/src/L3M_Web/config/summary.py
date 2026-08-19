
import logging
from L3M_Web.config.settings import Settings

logger = logging.getLogger(__name__)


def log_settings_summary(settings: Settings) -> None:
    """
    Log a safe, non-sensitive summary of the active configuration.
    """

    logger.info(
        "Environment:\n\tenv=%s\n\tLog level: %s\n\tProjet name: %s",
        settings.env,
        settings.log_level.upper(),
        settings.app_name
    )

    # -------------------------
    # AI Settings
    # -------------------------

    ai_status = []

    ai_status.append(f"ollama model={settings.ollama_model}")
    ai_status.append(f"ollama base URL={settings.ollama_base_url}")

    logger.info(
        "AI providers:\n\t%s",
        "\n\t".join(ai_status),
    )

    # -------------------------
    # Database Settings
    # -------------------------

    database_status = []

    database_status.append(f"host={settings.db_host}")
    database_status.append(f"port={settings.db_port}")
    database_status.append(f"database={settings.mysql_database}")
    database_status.append(f"username={settings.mysql_user}")

    logger.info(
        "Database:\n\t%s",
        "\n\t".join(database_status),
    )
