"""All alert rules live here (see notifications-jobs skill).

Flow: raise_alert() inserts rows (deduplicated per caregiver) inside the caller's transaction and
returns the new ids. After commit the caller runs dispatch() to publish realtime + queue push."""

import math
from dataclasses import dataclass, field
from datetime import date, time

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.redis import get_redis
from app.core.timeutil import device_today
from app.models import Alert, Medicine, Patient, Schedule
from app.realtime.publisher import publish, publish_user
from app.repositories import patients as patient_repo

log = get_logger(__name__)

PUSH_QUEUE = "push:queue"
SEVERITY = {
    "missed": "high",
    "expired_dose": "high",
    "offline": "high",
    "low_stock": "normal",
    "expiry": "normal",
    "scan_unknown": "normal",
    "taken": "info",
}


@dataclass
class Created:
    """New alert ids grouped by patient, dispatched after commit."""

    items: list[tuple[int | None, int, int]] = field(default_factory=list)  # (patient_id, user_id, alert_id)

    def extend(self, other: "Created") -> None:
        self.items.extend(other.items)

    def __bool__(self) -> bool:
        return bool(self.items)


def fmt_time(t: time) -> str:
    h = t.hour % 12 or 12
    return f"{h}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def med_word(user_pref_hide: bool, med: Medicine) -> str:
    return "a medicine" if user_pref_hide else med.label


async def raise_alert(
    db: AsyncSession,
    patient: Patient,
    type_: str,
    dedup_key: str,
    title: str,
    body: str,
    data: dict | None = None,
    med: Medicine | None = None,
) -> Created:
    """Insert one alert per caregiver who wants this type. `{med}` in title/body is replaced per
    caregiver, honouring the hide_medicine_names preference."""
    created = Created()
    for user, _role in await patient_repo.caregivers(db, patient.id):
        if not user.pref(type_):
            continue
        word = med_word(user.pref("hide_medicine_names"), med) if med else ""
        stmt = (
            insert(Alert)
            .values(
                user_id=user.id,
                patient_id=patient.id,
                type=type_,
                severity=SEVERITY.get(type_, "normal"),
                title=title.replace("{med}", word)[:120],
                body=body.replace("{med}", word)[:300],
                data={"patientId": patient.id, "url": f"/patients/{patient.id}", **(data or {})},
                dedup_key=dedup_key,
            )
            .on_conflict_do_nothing(constraint="uq_alerts_user_dedup")
            .returning(Alert.id)
        )
        alert_id = await db.scalar(stmt)
        if alert_id:
            created.items.append((patient.id, user.id, alert_id))
    return created


async def dispatch(created: Created) -> None:
    """After commit: realtime hint to the patient's caregivers + queue push for the worker."""
    if not created:
        return
    for patient_id in {p for p, _, _ in created.items if p is not None}:
        await publish(patient_id, "alert.created")
    for patient_id, user_id, alert_id in created.items:
        if patient_id is None:
            await publish_user(user_id, "alert.created")
        try:
            await get_redis().lpush(PUSH_QUEUE, alert_id)
        except Exception:
            log.warning("push_queue_failed", alert_id=alert_id)
    log.info("alerts_created", count=len(created.items))


# ---- rules -------------------------------------------------------------------------------------


async def missed(db: AsyncSession, patient: Patient, med: Medicine, schedule_id: int, day: date, t: time) -> Created:
    return await raise_alert(
        db,
        patient,
        "missed",
        f"missed:{schedule_id}:{day.isoformat()}",
        f"{patient.display_name} missed a dose",
        f"{patient.display_name} missed {{med}} ({fmt_time(t)}).",
        {"scheduleId": schedule_id, "date": day.isoformat()},
        med,
    )


async def taken(
    db: AsyncSession, patient: Patient, med: Medicine, schedule_id: int, day: date, t: time, delay: int
) -> Created:
    late = f", {delay} min late" if delay > 0 else ""
    return await raise_alert(
        db,
        patient,
        "taken",
        f"taken:{schedule_id}:{day.isoformat()}",
        f"{patient.display_name} took a dose",
        f"{patient.display_name} took {{med}} ({fmt_time(t)}{late}).",
        {"scheduleId": schedule_id, "date": day.isoformat()},
        med,
    )


async def expired_dose(
    db: AsyncSession, patient: Patient, med: Medicine, schedule_id: int, day: date, t: time
) -> Created:
    return await raise_alert(
        db,
        patient,
        "expired_dose",
        f"expdose:{schedule_id}:{day.isoformat()}",
        "Expired medicine is due",
        f"{{med}} is past its expiry date and was due at {fmt_time(t)}. Please replace it.",
        {"medicineId": med.id},
        med,
    )


def days_left(qty: int, dose_amount: int, schedules_days: list[list[int]]) -> float:
    per_day = dose_amount * sum(len(set(d)) / 7 for d in schedules_days)
    return math.inf if per_day <= 0 else qty / per_day


async def low_stock(db: AsyncSession, patient: Patient, med: Medicine) -> Created:
    """Low stock or refill reminder: qty <= threshold or days left <= refill lead time. Once a day."""
    scheds = [s.days_of_week for s in await _active_schedules(db, med.id)]
    left = days_left(med.qty, med.dose_amount, scheds)
    if med.qty > med.low_stock_threshold and left > med.refill_lead_days:
        return Created()
    days_txt = "" if math.isinf(left) else f" (about {math.floor(left)} day{'s' if math.floor(left) != 1 else ''})"
    return await raise_alert(
        db,
        patient,
        "low_stock",
        f"refill:{med.id}:{device_today().isoformat()}",
        "Time to refill",
        f"{{med}} is running low: {med.qty} left{days_txt}.",
        {"medicineId": med.id, "qty": med.qty},
        med,
    )


async def expiry(db: AsyncSession, patient: Patient, med: Medicine, today: date) -> Created:
    """30 / 7 / 0 days before expiry; each bucket once per expiry date."""
    if not med.expiry_date:
        return Created()
    left = (med.expiry_date - today).days
    bucket = 0 if left <= 0 else 7 if left <= 7 else 30 if left <= 30 else None
    if bucket is None:
        return Created()
    if left < 0:
        body = f"{{med}} expired on {med.expiry_date.isoformat()}. Please replace it."
    elif left == 0:
        body = "{med} expires today. Please replace it."
    else:
        body = f"{{med}} expires in {left} day{'s' if left != 1 else ''} ({med.expiry_date.isoformat()})."
    return await raise_alert(
        db,
        patient,
        "expiry",
        f"expiry:{med.id}:{med.expiry_date.isoformat()}:{bucket}",
        "Medicine expiring" if left > 0 else "Medicine expired",
        body,
        {"medicineId": med.id},
        med,
    )


async def offline(db: AsyncSession, patient: Patient, device_id: str, last_seen_epoch: int, since: str) -> Created:
    return await raise_alert(
        db,
        patient,
        "offline",
        f"offline:{device_id}:{last_seen_epoch}",
        "Pillbox is offline",
        f"{patient.display_name}'s pillbox has not checked in since {since}. Check its power and WiFi.",
        {"deviceId": device_id},
    )


async def scan_unknown(db: AsyncSession, patient: Patient, scan_id: int) -> Created:
    return await raise_alert(
        db,
        patient,
        "scan_unknown",
        f"scan:{scan_id}",
        "Unknown medicine scanned",
        f"The pillbox camera could not recognise a package for {patient.display_name}. Tap to review.",
        {"scanId": scan_id, "url": f"/patients/{patient.id}/scans"},
    )


async def _active_schedules(db: AsyncSession, medicine_id: int) -> list[Schedule]:
    return list(
        (await db.scalars(select(Schedule).where(Schedule.medicine_id == medicine_id, Schedule.active))).all()
    )
