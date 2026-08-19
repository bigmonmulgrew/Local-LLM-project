from pydantic import BaseModel, Field, computed_field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False)

    app_name: str = Field(default="L3M", alias="COMPOSE_PROJECT_NAME")
    log_level: str

    db_host: str = Field(default="mysql", alias="DB_HOST")
    db_port: int = Field(default=3306, alias="MYSQL_PORT")
    mysql_database: str
    mysql_user: str
    mysql_password: SecretStr

    ollama_base_url: str
    ollama_model: str