"""ESP32 contract schemas. FROZEN: field names and types must match the firmware exactly.
See .claude/skills/device-contract. These do not use the camelCase base on purpose."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Firmware buffer limits (chars, ASCII).
SCHEDULE_LIMITS = {"name": 23, "dose": 15, "instructions": 39, "expiry": 10}
SCAN_LIMITS = {"name": 31, "dose": 19, "instructions": 63, "expiry": 10}
MAX_DOSES = 20

EVENT_TYPES = (
    "due",
    "taken",
    "missed",
    "expired",
    "opened",
    "closed",
    "scan_ok",
    "scan_expired",
    "scan_unknown",
    "scan_fail",
)


class DoseOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int
    slot: int
    name: str
    dose: str
    time: str
    instructions: str
    expiry: str
    qty: int


class ScheduleOut(BaseModel):
    doses: list[DoseOut]


class ScanFound(BaseModel):
    model_config = ConfigDict(extra="forbid")
    found: bool = True
    name: str
    dose: str
    instructions: str
    expiry: str
    slot: int
    qty: int
    low: bool
    expired: bool


class EventIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    device: str = Field(min_length=1, max_length=32)
    type: str = Field(min_length=1, max_length=20)
    slot: int | None = Field(default=None, ge=0, le=5)
    doseId: int | None = Field(default=None, ge=0)
    time: datetime

    @field_validator("time")
    @classmethod
    def _naive_local(cls, v: datetime) -> datetime:
        # The firmware sends PH local time without an offset; drop one if a client adds it.
        return v.replace(tzinfo=None, microsecond=0)
