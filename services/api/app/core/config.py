from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

EXAMPLE_SECRET = "change-me-to-a-long-random-string-at-least-32-bytes"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    log_level: str = "INFO"
    enable_docs: bool = False

    database_url: str = "postgresql+asyncpg://medrem:medrem@db:5432/medrem"
    redis_url: str = "redis://redis:6379/0"

    jwt_secret: str = EXAMPLE_SECRET
    jwt_access_minutes: int = 15
    jwt_refresh_days: int = 30

    cors_origins: str = "http://localhost:8081,http://localhost:19006"

    device_tz: str = "Asia/Manila"
    late_after_minutes: int = 15
    online_window_seconds: int = 180
    offline_alert_minutes: int = 10
    missed_fallback_minutes: int = 35

    rate_limit_enabled: bool = True

    scan_dir: str = "/data/scans"
    scan_retention_days: int = 30
    scan_max_bytes: int = 4 * 1024 * 1024
    scan_budget_seconds: float = 8.5

    vision_enabled: bool = True
    vision_ocr_threshold: float = 80.0
    vision_ocr_margin: float = 8.0
    vision_embed_threshold: float = 0.85
    vision_embed_margin: float = 0.03
    vision_clip_model: str = "ViT-B-32"
    vision_clip_pretrained: str = "laion2b_s34b_b79k"
    vision_llm_fallback: bool = False
    vision_llm_model: str = "claude-sonnet-5-5"
    anthropic_api_key: str = ""

    expo_push_enabled: bool = True
    expo_access_token: str = ""
    expo_push_url: str = "https://exp.host/--/api/v2/push/send"

    seed_demo: bool = False

    retention_events_days: int = 180
    retention_alerts_days: int = 90

    @field_validator("jwt_secret")
    @classmethod
    def _secret_len(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def llm_enabled(self) -> bool:
        return self.vision_llm_fallback and bool(self.anthropic_api_key)

    def check_prod(self) -> None:
        if self.env == "prod" and self.jwt_secret == EXAMPLE_SECRET:
            raise RuntimeError("Refusing to start in prod with the example JWT_SECRET")


@lru_cache
def get_settings() -> Settings:
    return Settings()
