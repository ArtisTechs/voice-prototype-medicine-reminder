from datetime import datetime

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Device


async def by_any_id(db: AsyncSession, ident: str) -> Device | None:
    return await db.scalar(select(Device).where(or_(Device.device_id == ident, Device.camera_id == ident)))


async def by_device_id(db: AsyncSession, device_id: str) -> Device | None:
    return await db.scalar(select(Device).where(Device.device_id == device_id))


async def by_camera_id(db: AsyncSession, camera_id: str) -> Device | None:
    return await db.scalar(select(Device).where(Device.camera_id == camera_id))


async def for_patient(db: AsyncSession, patient_id: int) -> Device | None:
    return await db.scalar(select(Device).where(Device.patient_id == patient_id))


async def ids_in_use(db: AsyncSession, ids: list[str]) -> bool:
    found = await db.scalar(
        select(Device.id).where(or_(Device.device_id.in_(ids), Device.camera_id.in_(ids))).limit(1)
    )
    return found is not None


async def touch(db: AsyncSession, device: Device, now: datetime, camera: bool = False) -> None:
    col = Device.camera_last_seen if camera else Device.last_seen
    await db.execute(update(Device).where(Device.id == device.id).values({col: now}))


async def stale(db: AsyncSession, before: datetime) -> list[Device]:
    return list(
        (await db.scalars(select(Device).where(Device.last_seen.is_not(None), Device.last_seen < before))).all()
    )
