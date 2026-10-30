from fastapi import APIRouter

from app.core.config import get_settings
from app.core.timeutil import device_now

router = APIRouter(tags=["meta"])


@router.get("/meta")
async def meta() -> dict:
    """Public, no personal data. The app's first screen calls this to show the server is reachable."""
    return {
        "name": "Medicine Reminder API",
        "version": "1.0.0",
        "deviceTz": get_settings().device_tz,
        "serverTime": device_now().isoformat(timespec="seconds"),
    }
