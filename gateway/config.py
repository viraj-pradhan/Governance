"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # MongoDB Atlas
    mongodb_url: str = ""

    # Postgres (legacy fallback)
    database_url: str = "postgresql://gov_user:gov_pass@localhost:5432/governance"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # OPA
    opa_url: str = "http://localhost:8181"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
