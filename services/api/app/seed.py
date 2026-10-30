"""Demo data. Idempotent: does nothing if the demo caregiver exists. `--reset` removes it first.

python -m app.seed [--reset]
"""

import asyncio
import sys
from datetime import date, time, timedelta

from sqlalchemy import delete, select

from app.core.db import dispose_engine, session_scope
from app.core.logging import get_logger, setup_logging
from app.core.security import hash_password
from app.core.timeutil import device_today, dose_instant
from app.models import Device, IntakeRecord, Medicine, Patient, PatientCaregiver, Schedule, User
from app.repositories import patients as patient_repo

log = get_logger(__name__)

DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "demo1234"


def ean13(body12: str) -> str:
    total = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(body12))
    return body12 + str((10 - total % 10) % 10)


# name, strength, slot, instructions, barcode, expiry, qty, threshold, times
DEMO_MEDICINES = [
    ("Losartan", "50mg", 1, "After breakfast", ean13("480012345678"), date(2027, 6, 30), 24, 5, [time(8, 0)]),
    ("Metformin", "500mg", 2, "With meals", ean13("480098765432"), date(2027, 3, 31), 4, 6,
     [time(8, 0), time(20, 0)]),
    ("Amlodipine", "5mg", 3, "After lunch", ean13("480055512345"), date(2026, 9, 30), 18, 5, [time(13, 0)]),
]


async def reset(db) -> None:
    user = await db.scalar(select(User).where(User.email == DEMO_EMAIL))
    if user is None:
        return
    for patient, _role in await patient_repo.for_user(db, user.id):
        await db.execute(delete(Patient).where(Patient.id == patient.id))
    await db.execute(delete(User).where(User.id == user.id))
    await db.commit()


async def seed(db) -> bool:
    if await db.scalar(select(User.id).where(User.email == DEMO_EMAIL)):
        return False
    user = User(email=DEMO_EMAIL, password_hash=hash_password(DEMO_PASSWORD), name="Demo Caregiver")
    patient = Patient(display_name="Lola Rosa", note="Demo patient")
    db.add_all([user, patient])
    await db.flush()
    db.add(PatientCaregiver(patient_id=patient.id, user_id=user.id, role="owner"))
    db.add(Device(patient_id=patient.id, device_id="pillbox", camera_id="pillbox-cam", slot_state={}))

    today = device_today()
    for name, strength, slot, instr, code, expiry, qty, threshold, times in DEMO_MEDICINES:
        med = Medicine(
            patient_id=patient.id,
            name=name,
            strength=strength,
            form="tablet",
            dose_amount=1,
            dose_unit="tablet",
            instructions=instr,
            slot=slot,
            barcode=code,
            expiry_date=expiry,
            qty=qty,
            low_stock_threshold=threshold,
            refill_lead_days=3,
        )
        db.add(med)
        await db.flush()
        for t in times:
            sched = Schedule(medicine_id=med.id, time=t, days_of_week=[0, 1, 2, 3, 4, 5, 6])
            db.add(sched)
            await db.flush()
            _history(db, patient.id, med.id, sched.id, t, today)
    await db.commit()
    await _seed_references(db)
    return True


def _history(db, patient_id: int, medicine_id: int, schedule_id: int, t: time, today: date) -> None:
    """Three past days: mostly on time, one late, one missed."""
    pattern = {3: (0, "taken"), 2: (25, "taken"), 1: (None, "missed")}
    for days_ago, (delay, status) in pattern.items():
        day = today - timedelta(days=days_ago)
        if status == "missed" and schedule_id % 2 == 0:
            delay, status = 4, "taken"
        due = dose_instant(day, t)
        db.add(
            IntakeRecord(
                patient_id=patient_id,
                medicine_id=medicine_id,
                schedule_id=schedule_id,
                dose_date=day,
                scheduled_time=t,
                status=status,
                due_at=due,
                taken_at=due + timedelta(minutes=delay) if status == "taken" else None,
                delay_minutes=delay if status == "taken" else None,
            )
        )


async def _seed_references(db) -> None:
    """Reference images for the scan matcher (added once vision is available)."""
    try:
        from app.services import reference_service
    except ImportError:
        return
    await reference_service.seed_demo_references(db)


async def main() -> None:
    setup_logging()
    async with session_scope() as db:
        if "--reset" in sys.argv:
            await reset(db)
            log.info("seed_reset")
        created = await seed(db)
    log.info("seed_done", created=created)
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
