"""Timed checks the worker runs: missed-dose fallback, pillbox offline, refill, expiry, retention."""

from datetime import date, datetime, timedelta

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.timeutil import device_now, device_tz, dose_instant, utcnow
from app.models import Alert, Device, IntakeRecord, Invite, Medicine, Patient, RefreshToken, Scan
from app.realtime.publisher import publish
from app.repositories import devices as device_repo
from app.repositories import events as event_repo
from app.repositories import medicines as med_repo
from app.services import alert_service
from app.services.alert_service import Created

log = get_logger(__name__)


async def reconcile_missed(db: AsyncSession) -> Created:
    """D8: a dose >35 min past its time today with no record (and a schedule that existed then) is missed.
    Only devices that are paired count: unslotted medicines never get reminders."""
    s = get_settings()
    now = device_now()
    day = now.date()
    created = Created()
    touched: set[int] = set()
    devices = (await db.scalars(select(Device))).all()
    for dev in devices:
        recs = {r.schedule_id for r in await event_repo.intakes_for_day(db, dev.patient_id, day)}
        patient = await db.get(Patient, dev.patient_id)
        for sched, med in await med_repo.device_doses(db, dev.patient_id, day.weekday()):
            if sched.id in recs:
                continue
            at = dose_instant(day, sched.time)
            if now - at < timedelta(minutes=s.missed_fallback_minutes) or sched.created_at > at:
                continue
            res = await db.execute(
                insert(IntakeRecord)
                .values(
                    patient_id=med.patient_id,
                    medicine_id=med.id,
                    schedule_id=sched.id,
                    dose_date=day,
                    scheduled_time=sched.time,
                    status="missed",
                    due_at=at,
                    source="fallback",
                )
                .on_conflict_do_nothing(constraint="uq_intake_records_schedule_date")
                .returning(IntakeRecord.id)
            )
            if res.scalar() is None:
                continue
            touched.add(dev.patient_id)
            created.extend(await alert_service.missed(db, patient, med, sched.id, day, sched.time))
    await db.commit()
    for pid in touched:
        await publish(pid, "intake.updated")
    return created


async def offline_devices(db: AsyncSession) -> Created:
    """Alert once per outage when a pillbox has not been seen for OFFLINE_ALERT_MINUTES."""
    s = get_settings()
    created = Created()
    for dev in await device_repo.stale(db, utcnow() - timedelta(minutes=s.offline_alert_minutes)):
        assert dev.last_seen is not None
        patient = await db.get(Patient, dev.patient_id)
        since = dev.last_seen.astimezone(device_tz())
        label = f"{since.strftime('%-I:%M %p')}" + ("" if since.date() == device_now().date() else f" on {since:%b %-d}")
        created.extend(
            await alert_service.offline(db, patient, dev.device_id, int(dev.last_seen.timestamp()), label)
        )
    await db.commit()
    return created


async def inventory(db: AsyncSession) -> Created:
    created = Created()
    for med in await med_repo.all_active(db):
        patient = await db.get(Patient, med.patient_id)
        created.extend(await alert_service.low_stock(db, patient, med))
    await db.commit()
    return created


async def expiry(db: AsyncSession, today: date | None = None) -> Created:
    today = today or device_now().date()
    created = Created()
    meds = (await db.scalars(select(Medicine).where(Medicine.active, Medicine.expiry_date.is_not(None)))).all()
    for med in meds:
        patient = await db.get(Patient, med.patient_id)
        created.extend(await alert_service.expiry(db, patient, med, today))
    await db.commit()
    return created


async def cleanup(db: AsyncSession, now: datetime | None = None) -> dict[str, int]:
    """Retention: scans (and files) 30 d, device events 180 d, alerts 90 d, used/expired invites, old tokens."""
    s = get_settings()
    now = now or utcnow()
    old_scans = (
        await db.scalars(select(Scan).where(Scan.created_at < now - timedelta(days=s.scan_retention_days)))
    ).all()
    paths = [sc.image_path for sc in old_scans]
    for sc in old_scans:
        await db.delete(sc)
    events = await event_repo.delete_events_before(db, now - timedelta(days=s.retention_events_days))
    alerts = (
        await db.execute(delete(Alert).where(Alert.created_at < now - timedelta(days=s.retention_alerts_days)))
    ).rowcount
    await db.execute(delete(Invite).where(Invite.expires_at < now - timedelta(days=1)))
    await db.execute(delete(RefreshToken).where(RefreshToken.expires_at < now))
    await db.commit()
    for p in paths:
        await run_in_threadpool(storage.delete, p)
    counts = {"scans": len(paths), "events": events, "alerts": alerts or 0}
    log.info("cleanup_done", **counts)
    return counts
