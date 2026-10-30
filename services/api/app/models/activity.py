from datetime import date, datetime, time

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

INTAKE_STATUSES = ("due", "taken", "missed", "expired")


class DeviceEvent(Base):
    """Raw device events. Idempotent on (device_id, type, dose_id, local_time)."""

    __tablename__ = "device_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[str] = mapped_column(String(32))
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(20))
    slot: Mapped[int | None] = mapped_column(SmallInteger)
    dose_id: Mapped[int] = mapped_column(Integer, server_default="0")
    local_time: Mapped[datetime] = mapped_column(DateTime(timezone=False))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        UniqueConstraint("device_id", "type", "dose_id", "local_time", name="uq_device_events_idem"),
        Index("ix_device_events_received", "received_at"),
    )


class IntakeRecord(Base):
    """Outcome of one dose (schedule) on one device-local date."""

    __tablename__ = "intake_records"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    medicine_id: Mapped[int] = mapped_column(ForeignKey("medicines.id", ondelete="CASCADE"), index=True)
    schedule_id: Mapped[int | None] = mapped_column(ForeignKey("schedules.id", ondelete="SET NULL"))
    dose_date: Mapped[date] = mapped_column(Date)
    scheduled_time: Mapped[time] = mapped_column(Time)
    status: Mapped[str] = mapped_column(String(8))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    taken_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delay_minutes: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(8), server_default="device")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    __table_args__ = (
        UniqueConstraint("schedule_id", "dose_date", name="uq_intake_records_schedule_date"),
        CheckConstraint("status in ('due','taken','missed','expired')", name="status"),
        Index("ix_intake_records_patient_date", "patient_id", "dose_date"),
    )


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    patient_id: Mapped[int | None] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(16))
    severity: Mapped[str] = mapped_column(String(8), server_default="normal")
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(String(300))
    data: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    dedup_key: Mapped[str] = mapped_column(String(120))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pushed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        UniqueConstraint("user_id", "dedup_key", name="uq_alerts_user_dedup"),
        Index("ix_alerts_user_created", "user_id", "created_at"),
        CheckConstraint("severity in ('high','normal','info')", name="severity"),
    )


class Scan(Base):
    __tablename__ = "scans"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"))
    device_id: Mapped[str] = mapped_column(String(32))
    image_path: Mapped[str] = mapped_column(String(255))
    found: Mapped[bool] = mapped_column(Boolean)
    method: Mapped[str] = mapped_column(String(10))
    score: Mapped[float | None] = mapped_column(Float)
    medicine_id: Mapped[int | None] = mapped_column(ForeignKey("medicines.id", ondelete="SET NULL"))
    corrected_medicine_id: Mapped[int | None] = mapped_column(ForeignKey("medicines.id", ondelete="SET NULL"))
    corrected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    corrected_none: Mapped[bool] = mapped_column(Boolean, server_default="false")
    result: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    ocr_expiry: Mapped[str | None] = mapped_column(String(10))
    timings: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    duration_ms: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        Index("ix_scans_patient_created", "patient_id", "created_at"),
        Index("ix_scans_created", "created_at"),
    )
