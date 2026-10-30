"""Medicines, inventory and schedules. Schedule ids are the device dose ids (D3)."""

import math

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.core.timeutil import device_today
from app.models import Medicine, Patient, ReferenceImage, Schedule
from app.realtime.publisher import publish
from app.repositories import medicines as med_repo
from app.schemas.medicine import MedicineCreate, MedicineOut, MedicineUpdate, ScheduleIn, ScheduleOut, ScheduleUpdate
from app.services import alert_service

MAX_SCHEDULES_PER_MEDICINE = 8


async def to_out(db: AsyncSession, med: Medicine) -> MedicineOut:
    schedules = [s for s in med.schedules] if "schedules" in med.__dict__ else []
    left = alert_service.days_left(med.qty, med.dose_amount, [s.days_of_week for s in schedules if s.active])
    photos = await db.scalar(
        select(func.count()).select_from(ReferenceImage).where(ReferenceImage.medicine_id == med.id)
    )
    out = MedicineOut.model_validate(med, from_attributes=True)
    out.schedules = [ScheduleOut.model_validate(s) for s in schedules]
    out.low_stock = med.qty <= med.low_stock_threshold or left <= med.refill_lead_days
    out.expired = bool(med.expiry_date and med.expiry_date < device_today())
    out.days_left = None if math.isinf(left) else round(left, 1)
    out.photo_count = photos or 0
    return out


async def get(db: AsyncSession, patient_id: int, medicine_id: int) -> Medicine:
    med = await med_repo.get(db, patient_id, medicine_id, with_schedules=True)
    if med is None or not med.active:
        raise NotFound("not_found", "Medicine not found.")
    return med


async def _check_slot(db: AsyncSession, patient_id: int, slot: int | None, exclude: int | None = None) -> None:
    if slot and await med_repo.slot_in_use(db, patient_id, slot, exclude):
        raise Conflict("slot_taken", f"Slot {slot} already has a medicine. Choose another slot or empty it first.")


async def create(db: AsyncSession, patient_id: int, data: MedicineCreate) -> Medicine:
    await _check_slot(db, patient_id, data.slot)
    med = Medicine(patient_id=patient_id, **data.model_dump())
    db.add(med)
    await db.commit()
    await publish(patient_id, "medicine.updated", {"medicineId": med.id})
    return await get(db, patient_id, med.id)


async def update(db: AsyncSession, patient_id: int, medicine_id: int, data: MedicineUpdate) -> Medicine:
    med = await get(db, patient_id, medicine_id)
    changes = data.model_dump(exclude_unset=True)
    if "slot" in changes:
        await _check_slot(db, patient_id, changes["slot"], exclude=med.id)
    for k, v in changes.items():
        setattr(med, k, v)
    await db.flush()
    created = alert_service.Created()
    if "qty" in changes or "low_stock_threshold" in changes:
        patient = await db.get(Patient, patient_id)
        assert patient is not None
        created = await alert_service.low_stock(db, patient, med)
    await db.commit()
    await publish(patient_id, "medicine.updated", {"medicineId": med.id})
    await alert_service.dispatch(created)
    return await get(db, patient_id, med.id)


async def deactivate(db: AsyncSession, patient_id: int, medicine_id: int) -> None:
    """Soft delete: keeps intake history; frees the slot; its doses leave the device schedule."""
    med = await get(db, patient_id, medicine_id)
    med.active = False
    med.slot = None
    await db.commit()
    await publish(patient_id, "medicine.updated", {"medicineId": med.id})


async def add_schedule(db: AsyncSession, patient_id: int, medicine_id: int, data: ScheduleIn) -> Schedule:
    med = await get(db, patient_id, medicine_id)
    if len(med.schedules) >= MAX_SCHEDULES_PER_MEDICINE:
        raise Conflict("too_many_schedules", f"A medicine can have at most {MAX_SCHEDULES_PER_MEDICINE} dose times.")
    if any(s.time == data.time for s in med.schedules):
        raise Conflict("schedule_exists", "This medicine already has a dose at that time.")
    sched = Schedule(medicine_id=med.id, **data.model_dump())
    db.add(sched)
    await db.commit()
    await publish(patient_id, "medicine.updated", {"medicineId": med.id})
    return sched


async def _schedule(db: AsyncSession, patient_id: int, medicine_id: int, schedule_id: int) -> Schedule:
    sched = await db.scalar(
        select(Schedule)
        .join(Medicine, Medicine.id == Schedule.medicine_id)
        .where(Schedule.id == schedule_id, Medicine.id == medicine_id, Medicine.patient_id == patient_id)
    )
    if sched is None:
        raise NotFound("not_found", "Dose time not found.")
    return sched


async def update_schedule(
    db: AsyncSession, patient_id: int, medicine_id: int, schedule_id: int, data: ScheduleUpdate
) -> Schedule:
    sched = await _schedule(db, patient_id, medicine_id, schedule_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(sched, k, v)
    await db.commit()
    await publish(patient_id, "medicine.updated", {"medicineId": medicine_id})
    return sched


async def delete_schedule(db: AsyncSession, patient_id: int, medicine_id: int, schedule_id: int) -> None:
    sched = await _schedule(db, patient_id, medicine_id, schedule_id)
    await db.delete(sched)
    await db.commit()
    await publish(patient_id, "medicine.updated", {"medicineId": medicine_id})
