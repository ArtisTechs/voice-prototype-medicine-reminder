from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin

DEFAULT_NOTIFY_PREFS = {
    "missed": True,
    "taken": False,
    "low_stock": True,
    "expiry": True,
    "expired_dose": True,
    "offline": True,
    "scan_unknown": True,
    "hide_medicine_names": False,
}


class User(Base, TimestampMixin):
    """A caregiver account."""

    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(80))
    timezone: Mapped[str] = mapped_column(String(64), server_default="Asia/Manila")
    notify_prefs: Mapped[dict] = mapped_column(JSONB, default=lambda: dict(DEFAULT_NOTIFY_PREFS), server_default=text("'{}'::jsonb"))

    def pref(self, key: str) -> bool:
        return bool({**DEFAULT_NOTIFY_PREFS, **(self.notify_prefs or {})}.get(key, True))


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    jti: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PushToken(Base):
    __tablename__ = "push_tokens"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(255), unique=True)
    platform: Mapped[str] = mapped_column(String(16), server_default="unknown")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (CheckConstraint("platform in ('ios','android','web','unknown')", name="platform"),)
