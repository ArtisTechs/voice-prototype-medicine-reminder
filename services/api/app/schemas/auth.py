from datetime import datetime
from zoneinfo import available_timezones

from pydantic import EmailStr, Field, field_validator

from app.schemas.common import ApiModel


class SignupIn(ApiModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=80)


class LoginIn(ApiModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshIn(ApiModel):
    refresh_token: str = Field(min_length=10, max_length=2048)


class TokensOut(ApiModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class NotifyPrefs(ApiModel):
    missed: bool = True
    taken: bool = False
    low_stock: bool = True
    expiry: bool = True
    expired_dose: bool = True
    offline: bool = True
    scan_unknown: bool = True
    hide_medicine_names: bool = False


class MeOut(ApiModel):
    id: int
    email: str
    name: str
    timezone: str
    notify_prefs: NotifyPrefs
    created_at: datetime


class MeUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    timezone: str | None = None
    notify_prefs: NotifyPrefs | None = None

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str | None) -> str | None:
        if v is not None and v not in available_timezones():
            raise ValueError("Unknown time zone")
        return v


class PushTokenIn(ApiModel):
    token: str = Field(min_length=10, max_length=255, pattern=r"^(ExponentPushToken|ExpoPushToken)\[.+\]$")
    platform: str = Field(default="unknown", pattern=r"^(ios|android|web|unknown)$")
