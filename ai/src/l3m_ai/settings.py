from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-backed settings for the AI proxy."""

    model_config = SettingsConfigDict(case_sensitive=False)

    log_level: str = "INFO"
    ai_host: str = "0.0.0.0"
    ai_port: int = Field(default=8020, ge=1, le=65535)
    ollama_base_url: str = "http://ollama:11434"
