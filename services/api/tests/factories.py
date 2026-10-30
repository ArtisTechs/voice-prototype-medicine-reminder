from datetime import date, time
from itertools import count

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models import Device, Medicine, Patient, PatientCaregiver, Schedule, User

_n = count(1)
_PW = hash_password("password123")


async def make_user(db: AsyncSession, **kw) -> User:
    n = next(_n)
    user = User(email=kw.pop("email", f"user{n}@example.com"), password_hash=_PW, name=kw.pop("name", f"User {n}"), **kw)
    db.add(user)
    await db.flush()
    return user


async def make_patient(db: AsyncSession, user: User | None = None, role: str = "owner", **kw) -> Patient:
    patient = Patient(display_name=kw.pop("display_name", "Lola Test"), **kw)
    db.add(patient)
    await db.flush()
    if user:
        db.add(PatientCaregiver(patient_id=patient.id, user_id=user.id, role=role))
        await db.flush()
    return patient


async def pair_device(db: AsyncSession, patient: Patient, device_id: str = "pillbox", camera_id: str | None = None) -> Device:
    dev = Device(patient_id=patient.id, device_id=device_id, camera_id=camera_id or f"{device_id}-cam", slot_state={})
    db.add(dev)
    await db.flush()
    return dev


async def make_medicine(db: AsyncSession, patient: Patient, **kw) -> Medicine:
    defaults = dict(
        name="Losartan",
        strength="50mg",
        form="tablet",
        dose_amount=1,
        dose_unit="tablet",
        instructions="After breakfast",
        slot=1,
        expiry_date=date(2027, 6, 30),
        qty=24,
        low_stock_threshold=5,
        refill_lead_days=3,
    )
    defaults.update(kw)
    med = Medicine(patient_id=patient.id, **defaults)
    db.add(med)
    await db.flush()
    return med


async def make_schedule(db: AsyncSession, med: Medicine, at: time = time(8, 0), days=None, active=True) -> Schedule:
    sched = Schedule(medicine_id=med.id, time=at, days_of_week=days if days is not None else [0, 1, 2, 3, 4, 5, 6], active=active)
    db.add(sched)
    await db.flush()
    return sched
