"""APScheduler setup. Jobs call services; the alert rules live in services/alert_service.py."""

import time
from collections.abc import Awaitable, Callable

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.core.config import get_settings
from app.core.db import session_scope
from app.core.logging import get_logger
from app.jobs.locks import with_lock
from app.services import alert_service, monitor_service, reference_service

log = get_logger(__name__)


def job(name: str, fn: Callable, ttl: int = 300) -> Callable[[], Awaitable[None]]:
    """Wrap a service call: one run at a time across workers, own session, errors logged not raised."""

    async def run() -> None:
        async with with_lock(name, ttl) as mine:
            if not mine:
                return
            t0 = time.monotonic()
            try:
                async with session_scope() as db:
                    result = await fn(db)
                created = 0
                if isinstance(result, alert_service.Created):
                    created = len(result.items)
                    await alert_service.dispatch(result)
                log.info("job_done", job=name, ms=int((time.monotonic() - t0) * 1000), created=created)
            except Exception:
                log.exception("job_failed", job=name)

    run.__name__ = name
    return run


JOBS = {
    "reconcile_missed": job("reconcile_missed", monitor_service.reconcile_missed),
    "offline": job("offline", monitor_service.offline_devices),
    "inventory": job("inventory", monitor_service.inventory),
    "expiry": job("expiry", monitor_service.expiry),
    "cleanup": job("cleanup", monitor_service.cleanup, ttl=1800),
    "backfill_embeddings": job("backfill_embeddings", reference_service.backfill_embeddings, ttl=1800),
}


def build_scheduler() -> AsyncIOScheduler:
    tz = get_settings().device_tz
    scheduler = AsyncIOScheduler(
        timezone=tz, job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 60}
    )
    scheduler.add_job(JOBS["reconcile_missed"], IntervalTrigger(minutes=1), id="reconcile_missed")
    scheduler.add_job(JOBS["offline"], IntervalTrigger(minutes=1), id="offline")
    scheduler.add_job(JOBS["inventory"], CronTrigger(hour=9, minute=0, timezone=tz), id="inventory_daily")
    scheduler.add_job(JOBS["inventory"], IntervalTrigger(hours=6), id="inventory_6h")
    scheduler.add_job(JOBS["expiry"], CronTrigger(hour=8, minute=30, timezone=tz), id="expiry")
    scheduler.add_job(JOBS["cleanup"], CronTrigger(hour=3, minute=0, timezone=tz), id="cleanup")
    return scheduler


async def run_startup_jobs() -> None:
    """Catch up after downtime: expiry buckets and stock are checked once at start."""
    for name in ("expiry", "inventory"):
        await JOBS[name]()
