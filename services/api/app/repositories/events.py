from datetime import date, datetime

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DeviceEvent, IntakeRecord


async def insert_event(db: AsyncSession, **values) -> int | None:
    """Returns the new id, or None when the event is a duplicate (idempotency key hit)."""
    stmt = (
        insert(DeviceEvent)
        .values(**values)
        .on_conflict_do_nothing(constraint="uq_device_events_idem")
        .returning(DeviceEvent.id)
    )
    return await db.scalar(stmt)


async def get_intake(db: AsyncSession, schedule_id: int, dose_date: date) -> IntakeRecord | None:
    return await db.scalar(
        select(IntakeRecord)
        .where(IntakeRecord.schedule_id == schedule_id, IntakeRecord.dose_date == dose_date)
        .with_for_update()
    )


async def intakes_for_day(db: AsyncSession, patient_id: int, day: date) -> list[IntakeRecord]:
    return list(
        (
            await db.scalars(
                select(IntakeRecord).where(IntakeRecord.patient_id == patient_id, IntakeRecord.dose_date == day)
            )
        ).all()
    )


async def intakes_between(db: AsyncSession, patient_id: int, start: date, end: date) -> list[IntakeRecord]:
    return list(
        (
            await db.scalars(
                select(IntakeRecord)
                .where(
                    IntakeRecord.patient_id == patient_id,
                    IntakeRecord.dose_date >= start,
                    IntakeRecord.dose_date <= end,
                )
                .order_by(IntakeRecord.dose_date, IntakeRecord.scheduled_time)
            )
        ).all()
    )


async def delete_events_before(db: AsyncSession, before: datetime) -> int:
    res = await db.execute(delete(DeviceEvent).where(DeviceEvent.received_at < before))
    return res.rowcount or 0
