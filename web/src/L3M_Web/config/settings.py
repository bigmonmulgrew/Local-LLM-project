from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False)

    env: str = Field(default="dev", alias="ENVIRONMENT_TYPE")

    app_name: str = Field(default="L3M", alias="COMPOSE_PROJECT_NAME")
    log_level: str

    db_host: str = Field(default="mysql", alias="DB_HOST")
    db_port: int = Field(default=3306, alias="MYSQL_PORT")
    mysql_database: str
    mysql_user: str
    mysql_password: SecretStr

    ollama_base_url: str
    ollama_model: str

    upload_directory: Path = Field(
        default=Path("/app/data/uploads"),
        alias="UPLOAD_DIRECTORY",
    )
    max_upload_files: int = Field(
        default=5,
        ge=1,
        alias="MAX_UPLOAD_FILES",
    )
    max_upload_file_bytes: int = Field(
        default=10 * 1024 * 1024,
        ge=1,
        alias="MAX_UPLOAD_FILE_BYTES",
    )
    max_upload_total_bytes: int = Field(
        default=25 * 1024 * 1024,
        ge=1,
        alias="MAX_UPLOAD_TOTAL_BYTES",
    )