"""ESP32-facing behaviour. FROZEN contract: see .claude/skills/device-contract before editing."""

from datetime import date, datetime, timedelta

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Forbidden
from app.core.logging import get_logger
from app.core.text import fit
from app.core.timeutil import device_today, dose_instant, local_to_utc, minutes_between, utcnow
from app.models import Device, IntakeRecord, Medicine, Patient, Schedule
from app.realtime.publisher import publish
from app.repositories import devices as device_repo
from app.repositories import events as event_repo
from app.repositories import medicines as med_repo
from app.schemas.device import MAX_DOSES, SCHEDULE_LIMITS, DoseOut, EventIn, ScheduleOut
from app.services import alert_service
from app.services.alert_service import Created

log = get_logger(__name__)

DOSE_EVENTS = {"due", "taken", "missed", "expired"}


def dose_text(med: Medicine) -> str:
    unit = (med.dose_unit or med.form or "tablet").strip().lower()
    if med.dose_amount != 1 and len(unit) > 2 and not unit.endswith("s"):
        unit += "s"
    return f"{med.dose_amount} {unit}"


def expiry_text(med: Medicine) -> str:
    return med.expiry_date.isoformat() if med.expiry_date else ""


async def resolve(db: AsyncSession, ident: str | None, camera: bool = False) -> Device:
    ident = (ident or "").strip()
    device = (
        await device_repo.by_camera_id(db, ident) if camera else await device_repo.by_any_id(db, ident)
    ) if ident else None
    if device is None:
        log.info("device_rejected", camera=camera)
        raise Forbidden("device_not_registered", "This device is not paired. Pair it in the caregiver app.")
    return device


async def heartbeat(db: AsyncSession, device: Device, camera: bool = False) -> None:
    await device_repo.touch(db, device, utcnow(), camera=camera)


async def build_schedule(db: AsyncSession, device: Device) -> ScheduleOut:
    today = device_today()
    rows = await med_repo.device_doses(db, device.patient_id, today.weekday())
    doses = [
        DoseOut(
            id=s.id,
            slot=m.slot,
            name=fit(m.label, SCHEDULE_LIMITS["name"]),
            dose=fit(dose_text(m), SCHEDULE_LIMITS["dose"]),
            time=s.time.strftime("%H:%M"),
            instructions=fit(m.instructions, SCHEDULE_LIMITS["instructions"]),
            expiry=expiry_text(m)[: SCHEDULE_LIMITS["expiry"]],
            qty=max(0, m.qty),
        )
        for s, m in rows[:MAX_DOSES]
    ]
    if len(rows) > MAX_DOSES:
        log.warning("schedule_truncated", device=device.device_id, total=len(rows))
    return ScheduleOut(doses=doses)


async def get_schedule(db: AsyncSession, device: Device) -> ScheduleOut:
    await heartbeat(db, device)
    out = await build_schedule(db, device)
    await db.commit()
    await publish(device.patient_id, "device.updated")
    return out


def dose_date_for(event_local: datetime, sched: Schedule) -> date:
    """The local date of the dose an event refers to. A dose at 23:50 missed at 00:20 belongs to
    the previous day; an event up to 60 min early (clock skew) belongs to the same day."""
    candidate = datetime.combine(event_local.date(), sched.time)
    if candidate - event_local > timedelta(minutes=60):
        return event_local.date() - timedelta(days=1)
    return event_local.date()


async def _intake(db: AsyncSession, med: Medicine, sched: Schedule, day: date, status: str) -> IntakeRecord:
    await db.execute(
        insert(IntakeRecord)
        .values(
            patient_id=med.patient_id,
            medicine_id=med.id,
            schedule_id=sched.id,
            dose_date=day,
            scheduled_time=sched.time,
            status=status,
        )
        .on_conflict_do_nothing(constraint="uq_intake_records_schedule_date")
    )
    rec = await event_repo.get_intake(db, sched.id, day)
    assert rec is not None
    return rec


async def record_event(db: AsyncSession, body: EventIn) -> bool:
    """Store an event and apply its side effects. Returns False if it was a duplicate."""
    device = await resolve(db, body.device)
    now = utcnow()
    occurred = local_to_utc(body.time)
    dose_id = body.doseId or 0
    await heartbeat(db, device)

    event_id = await event_repo.insert_event(
        db,
        device_id=device.device_id,
        patient_id=device.patient_id,
        type=body.type,
        slot=body.slot or None,
        dose_id=dose_id,
        local_time=body.time,
        occurred_at=occurred,
        received_at=now,
    )
    if event_id is None:
        await db.commit()
        log.info("event_duplicate", type=body.type, dose_id=dose_id)
        return False

    created = Created()
    patient = await db.get(Patient, device.patient_id)
    assert patient is not None

    if body.type in DOSE_EVENTS and dose_id:
        found = await med_repo.get_schedule(db, dose_id)
        if found and found[1].patient_id == device.patient_id:
            sched, med = found
            created = await _dose_event(db, body.type, patient, med, sched, body.time, occurred)
        else:
            log.warning("event_unknown_dose", type=body.type, dose_id=dose_id)
    elif body.type in ("opened", "closed") and body.slot:
        state = dict(device.slot_state or {})
        state[str(body.slot)] = {"lidOpen": body.type == "opened", "at": occurred.isoformat()}
        await db.execute(update(Device).where(Device.id == device.id).values(slot_state=state))

    await db.commit()
    await publish(device.patient_id, "intake.updated" if body.type in DOSE_EVENTS else "device.updated")
    await alert_service.dispatch(created)
    log.info("event_recorded", type=body.type, dose_id=dose_id, event_id=event_id)
    return True


async def _dose_event(
    db: AsyncSession,
    type_: str,
    patient: Patient,
    med: Medicine,
    sched: Schedule,
    local: datetime,
    occurred: datetime,
) -> Created:
    day = dose_date_for(local, sched)
    rec = await _intake(db, med, sched, day, "due")
    created = Created()

    if type_ == "due":
        if rec.due_at is None:
            rec.due_at = occurred
    elif type_ == "taken" and rec.status != "taken":
        rec.status = "taken"
        rec.taken_at = occurred
        rec.delay_minutes = max(0, minutes_between(dose_instant(day, sched.time), occurred))
        locked = await med_repo.get_for_update(db, med.id)
        assert locked is not None
        locked.qty = max(0, locked.qty - locked.dose_amount)
        await db.flush()
        created.extend(await alert_service.taken(db, patient, locked, sched.id, day, sched.time, rec.delay_minutes))
        created.extend(await alert_service.low_stock(db, patient, locked))
    elif type_ == "missed" and rec.status == "due":
        rec.status = "missed"
        created.extend(await alert_service.missed(db, patient, med, sched.id, day, sched.time))
    elif type_ == "expired" and rec.status != "taken":
        rec.status = "expired"
        created.extend(await alert_service.expired_dose(db, patient, med, sched.id, day, sched.time))
    rec.source = "device"
    return created
