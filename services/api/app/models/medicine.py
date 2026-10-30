from datetime import date, datetime, time

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Time,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, TimestampMixin

EMBED_DIM = 512
ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]


class Medicine(Base, TimestampMixin):
    __tablename__ = "medicines"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    strength: Mapped[str | None] = mapped_column(String(30))
    form: Mapped[str | None] = mapped_column(String(20))
    dose_amount: Mapped[int] = mapped_column(SmallInteger, server_default="1")
    dose_unit: Mapped[str | None] = mapped_column(String(20))
    instructions: Mapped[str | None] = mapped_column(String(200))
    slot: Mapped[int | None] = mapped_column(SmallInteger)
    barcode: Mapped[str | None] = mapped_column(String(64), index=True)
    expiry_date: Mapped[date | None] = mapped_column(Date)
    qty: Mapped[int] = mapped_column(Integer, server_default="0")
    low_stock_threshold: Mapped[int] = mapped_column(Integer, server_default="5")
    refill_lead_days: Mapped[int] = mapped_column(Integer, server_default="3")
    active: Mapped[bool] = mapped_column(Boolean, server_default="true")

    schedules: Mapped[list["Schedule"]] = relationship(
        back_populates="medicine", lazy="raise", order_by="Schedule.time"
    )

    __table_args__ = (
        CheckConstraint("slot is null or slot between 1 and 5", name="slot_range"),
        CheckConstraint("dose_amount >= 1", name="dose_amount_pos"),
        CheckConstraint("qty >= 0", name="qty_nonneg"),
        Index(
            "uq_medicines_patient_slot",
            "patient_id",
            "slot",
            unique=True,
            postgresql_where=text("slot is not null and active"),
        ),
    )

    @property
    def label(self) -> str:
        return f"{self.name} {self.strength}".strip() if self.strength else self.name


class Schedule(Base, TimestampMixin):
    """One daily dose time of one medicine. Its id is the device dose id (D3)."""

    __tablename__ = "schedules"
    id: Mapped[int] = mapped_column(primary_key=True)
    medicine_id: Mapped[int] = mapped_column(ForeignKey("medicines.id", ondelete="CASCADE"), index=True)
    time: Mapped[time] = mapped_column(Time)
    days_of_week: Mapped[list[int]] = mapped_column(
        ARRAY(SmallInteger), server_default=text("'{0,1,2,3,4,5,6}'")
    )
    active: Mapped[bool] = mapped_column(Boolean, server_default="true")

    medicine: Mapped[Medicine] = relationship(back_populates="schedules", lazy="raise")


class ReferenceImage(Base):
    __tablename__ = "reference_images"
    id: Mapped[int] = mapped_column(primary_key=True)
    medicine_id: Mapped[int] = mapped_column(ForeignKey("medicines.id", ondelete="CASCADE"), index=True)
    angle: Mapped[str] = mapped_column(String(12))
    path: Mapped[str] = mapped_column(String(255))
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        CheckConstraint("angle in ('front','back','side','correction','other')", name="angle"),
        Index(
            "ix_reference_images_embedding",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )
