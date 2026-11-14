from pathlib import Path
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    database_url: str = "sqlite:///conflui.db"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    cookie_secure: bool = False
    session_hours: int = 8
    ingest_key: str = ""
    data_mode: Literal["simulator", "video"] = "simulator"
    shop_timezone: str = "America/Araguaina"
    stale_seconds: int = 30
    spatial_retention_days: int = 7
    history_retention_days: int = 90
    open_minute: int = 540
    close_minute: int = 1440


settings = Settings()
