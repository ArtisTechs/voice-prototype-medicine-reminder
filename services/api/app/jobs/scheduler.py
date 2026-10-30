"""APScheduler setup. Jobs call services; rules live in services/alert_service.py."""

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.config import get_settings


def build_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(
        timezone=get_settings().device_tz,
        job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 60},
    )
    return scheduler


async def run_startup_jobs() -> None:
    return None
