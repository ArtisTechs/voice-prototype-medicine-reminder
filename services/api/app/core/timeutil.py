"""Time helpers. Instants are UTC; device wall-clock times are DEVICE_TZ (Asia/Manila). See D5."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.core.config import get_settings


def device_tz() -> ZoneInfo:
    return ZoneInfo(get_settings().device_tz)


def utcnow() -> datetime:
    return datetime.now(UTC)


def device_now() -> datetime:
    """Aware datetime in the device time zone."""
    return utcnow().astimezone(device_tz())


def device_today() -> date:
    return device_now().date()


def local_to_utc(local: datetime) -> datetime:
    """Naive device-local datetime -> aware UTC."""
    return local.replace(tzinfo=device_tz()).astimezone(UTC)


def dose_instant(day: date, t: time) -> datetime:
    """The UTC instant of a wall-clock dose time on a device-local date."""
    return datetime.combine(day, t, tzinfo=device_tz()).astimezone(UTC)


def weekday_of(day: date) -> int:
    """Mon=0 .. Sun=6."""
    return day.weekday()


def minutes_between(a: datetime, b: datetime) -> int:
    return int((b - a) / timedelta(minutes=1))
