from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin


class Patient(Base, TimestampMixin):
    """Minimal data on purpose: a display name and an optional note (see security-privacy)."""

    __tablename__ = "patients"
    id: Mapped[int] = mapped_column(primary_key=True)
    display_name: Mapped[str] = mapped_column(String(60))
    note: Mapped[str | None] = mapped_column(String(200))


class PatientCaregiver(Base):
    __tablename__ = "patient_caregivers"
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(8), server_default="member")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (CheckConstraint("role in ('owner','member')", name="role"),)


class Invite(Base):
    __tablename__ = "invites"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(6), unique=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Device(Base, TimestampMixin):
    """A paired pillbox (main ESP32) and its camera. Ids are the firmware's fixed strings (D6)."""

    __tablename__ = "devices"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), unique=True)
    device_id: Mapped[str] = mapped_column(String(32), unique=True)
    camera_id: Mapped[str] = mapped_column(String(32), unique=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    camera_last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # {"1": {"lidOpen": true, "at": "<utc iso>"}}
    slot_state: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
