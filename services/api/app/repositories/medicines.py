from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Medicine, ReferenceImage, Schedule


async def get(db: AsyncSession, patient_id: int, medicine_id: int, with_schedules: bool = False) -> Medicine | None:
    q = select(Medicine).where(Medicine.id == medicine_id, Medicine.patient_id == patient_id)
    if with_schedules:
        q = q.options(selectinload(Medicine.schedules))
    return await db.scalar(q)


async def get_for_update(db: AsyncSession, medicine_id: int) -> Medicine | None:
    return await db.scalar(select(Medicine).where(Medicine.id == medicine_id).with_for_update())


async def list_for_patient(db: AsyncSession, patient_id: int, active_only: bool = True) -> list[Medicine]:
    q = (
        select(Medicine)
        .where(Medicine.patient_id == patient_id)
        .options(selectinload(Medicine.schedules))
        .order_by(Medicine.slot.nulls_last(), Medicine.name)
    )
    if active_only:
        q = q.where(Medicine.active)
    return list((await db.scalars(q)).all())


async def slot_in_use(db: AsyncSession, patient_id: int, slot: int, exclude_id: int | None = None) -> bool:
    q = select(Medicine.id).where(Medicine.patient_id == patient_id, Medicine.slot == slot, Medicine.active)
    if exclude_id:
        q = q.where(Medicine.id != exclude_id)
    return (await db.scalar(q.limit(1))) is not None


async def by_slot(db: AsyncSession, patient_id: int, slot: int) -> Medicine | None:
    return await db.scalar(
        select(Medicine).where(Medicine.patient_id == patient_id, Medicine.slot == slot, Medicine.active)
    )


async def device_doses(db: AsyncSession, patient_id: int, weekday: int) -> list[tuple[Schedule, Medicine]]:
    """Active schedules of active, slotted medicines that run on `weekday`, sorted time then slot."""
    q = (
        select(Schedule, Medicine)
        .join(Medicine, Schedule.medicine_id == Medicine.id)
        .where(
            Medicine.patient_id == patient_id,
            Medicine.active,
            Medicine.slot.is_not(None),
            Schedule.active,
            Schedule.days_of_week.any(weekday),
        )
        .order_by(Schedule.time, Medicine.slot, Schedule.id)
    )
    return [(s, m) for s, m in (await db.execute(q)).all()]


async def get_schedule(db: AsyncSession, schedule_id: int) -> tuple[Schedule, Medicine] | None:
    row = (
        await db.execute(
            select(Schedule, Medicine).join(Medicine, Schedule.medicine_id == Medicine.id).where(
                Schedule.id == schedule_id
            )
        )
    ).first()
    return (row[0], row[1]) if row else None


async def active_schedule_count(db: AsyncSession, medicine_id: int) -> int:
    return (
        await db.scalar(
            select(func.count()).select_from(Schedule).where(Schedule.medicine_id == medicine_id, Schedule.active)
        )
    ) or 0


async def all_active(db: AsyncSession) -> list[Medicine]:
    return list(
        (await db.scalars(select(Medicine).where(Medicine.active).options(selectinload(Medicine.schedules)))).all()
    )


async def reference_images(db: AsyncSession, medicine_id: int) -> list[ReferenceImage]:
    return list(
        (
            await db.scalars(
                select(ReferenceImage).where(ReferenceImage.medicine_id == medicine_id).order_by(ReferenceImage.id)
            )
        ).all()
    )


async def nearest_references(
    db: AsyncSession, medicine_ids: list[int], embedding: list[float], limit: int = 8
) -> list[tuple[int, float]]:
    """(medicine_id, cosine similarity) of the nearest reference images."""
    if not medicine_ids:
        return []
    dist = ReferenceImage.embedding.cosine_distance(embedding)
    rows = await db.execute(
        select(ReferenceImage.medicine_id, dist.label("d"))
        .where(ReferenceImage.medicine_id.in_(medicine_ids), ReferenceImage.embedding.is_not(None))
        .order_by(dist)
        .limit(limit)
    )
    return [(mid, 1.0 - float(d)) for mid, d in rows.all()]
