from datetime import date, datetime
from datetime import time as Time

from pydantic import Field, field_serializer, field_validator

from app.schemas.common import ApiModel


class MedicineBase(ApiModel):
    strength: str | None = Field(default=None, max_length=30)
    form: str | None = Field(default=None, max_length=20)
    dose_unit: str | None = Field(default=None, max_length=20)
    instructions: str | None = Field(default=None, max_length=200)
    slot: int | None = Field(default=None, ge=1, le=5)
    barcode: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9 \-]{1,64}$")
    expiry_date: date | None = None

    @field_validator("strength", "form", "dose_unit", "instructions", "barcode", mode="before")
    @classmethod
    def _blank_none(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v


class MedicineCreate(MedicineBase):
    name: str = Field(min_length=1, max_length=80)
    dose_amount: int = Field(default=1, ge=1, le=20)
    qty: int = Field(default=0, ge=0, le=10000)
    low_stock_threshold: int = Field(default=5, ge=0, le=1000)
    refill_lead_days: int = Field(default=3, ge=0, le=60)


class MedicineUpdate(MedicineBase):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    dose_amount: int | None = Field(default=None, ge=1, le=20)
    qty: int | None = Field(default=None, ge=0, le=10000)
    low_stock_threshold: int | None = Field(default=None, ge=0, le=1000)
    refill_lead_days: int | None = Field(default=None, ge=0, le=60)


def clean_days(v: list[int]) -> list[int]:
    if any(d < 0 or d > 6 for d in v):
        raise ValueError("Days are 0 (Monday) to 6 (Sunday)")
    return sorted(set(v))


class ScheduleIn(ApiModel):
    time: Time
    days_of_week: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5, 6], min_length=1, max_length=7)
    active: bool = True

    @field_validator("days_of_week")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        return clean_days(v)

    @field_validator("time")
    @classmethod
    def _minute(cls, v: Time) -> Time:
        return v.replace(second=0, microsecond=0, tzinfo=None)


class ScheduleUpdate(ApiModel):
    time: Time | None = None
    days_of_week: list[int] | None = Field(default=None, min_length=1, max_length=7)
    active: bool | None = None

    @field_validator("days_of_week")
    @classmethod
    def _days(cls, v: list[int] | None) -> list[int] | None:
        return None if v is None else clean_days(v)


class ScheduleOut(ApiModel):
    id: int
    medicine_id: int
    time: Time
    days_of_week: list[int]
    active: bool

    @field_serializer("time")
    def _hhmm(self, v: Time) -> str:
        return v.strftime("%H:%M")


class PhotoOut(ApiModel):
    id: int
    angle: str
    url: str
    created_at: datetime


class MedicineOut(ApiModel):
    id: int
    patient_id: int
    name: str
    strength: str | None
    form: str | None
    dose_amount: int
    dose_unit: str | None
    instructions: str | None
    slot: int | None
    barcode: str | None
    expiry_date: date | None
    qty: int
    low_stock_threshold: int
    refill_lead_days: int
    active: bool
    label: str
    low_stock: bool = False
    expired: bool = False
    days_left: float | None = None
    schedules: list[ScheduleOut] = []
    photo_count: int = 0
