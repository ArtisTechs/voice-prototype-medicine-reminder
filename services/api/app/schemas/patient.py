from datetime import datetime

from pydantic import Field

from app.schemas.common import ApiModel


class PatientCreate(ApiModel):
    display_name: str = Field(min_length=1, max_length=60)
    note: str | None = Field(default=None, max_length=200)


class PatientUpdate(ApiModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=60)
    note: str | None = Field(default=None, max_length=200)


class PatientOut(ApiModel):
    id: int
    display_name: str
    note: str | None
    role: str


class CaregiverOut(ApiModel):
    id: int
    name: str
    role: str


class InviteOut(ApiModel):
    code: str
    expires_at: datetime


class InviteAccept(ApiModel):
    code: str = Field(min_length=6, max_length=6)


class DevicePair(ApiModel):
    device_id: str = Field(min_length=2, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")
    camera_id: str | None = Field(default=None, min_length=2, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")


class SlotOut(ApiModel):
    slot: int
    medicine_id: int | None
    medicine_name: str | None
    lid_open: bool | None
    last_event_at: str | None


class DeviceOut(ApiModel):
    device_id: str
    camera_id: str
    status: str
    last_seen: datetime | None
    camera_last_seen: datetime | None
    slots: list[SlotOut]
