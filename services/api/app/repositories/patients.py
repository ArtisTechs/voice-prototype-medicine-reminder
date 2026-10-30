from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Patient, PatientCaregiver, User


async def link(db: AsyncSession, user_id: int, patient_id: int) -> PatientCaregiver | None:
    return await db.get(PatientCaregiver, (patient_id, user_id))


async def for_user(db: AsyncSession, user_id: int) -> list[tuple[Patient, str]]:
    rows = await db.execute(
        select(Patient, PatientCaregiver.role)
        .join(PatientCaregiver, PatientCaregiver.patient_id == Patient.id)
        .where(PatientCaregiver.user_id == user_id)
        .order_by(Patient.id)
    )
    return [(p, r) for p, r in rows.all()]


async def patient_ids_for_user(db: AsyncSession, user_id: int) -> list[int]:
    return list(
        (await db.scalars(select(PatientCaregiver.patient_id).where(PatientCaregiver.user_id == user_id))).all()
    )


async def caregivers(db: AsyncSession, patient_id: int) -> list[tuple[User, str]]:
    rows = await db.execute(
        select(User, PatientCaregiver.role)
        .join(PatientCaregiver, PatientCaregiver.user_id == User.id)
        .where(PatientCaregiver.patient_id == patient_id)
        .order_by(PatientCaregiver.created_at)
    )
    return [(u, r) for u, r in rows.all()]


async def caregiver_count(db: AsyncSession, patient_id: int) -> int:
    return (
        await db.scalar(
            select(func.count()).select_from(PatientCaregiver).where(PatientCaregiver.patient_id == patient_id)
        )
    ) or 0
