"""Patients, caregiver sharing (invite codes), device pairing, account deletion."""

import secrets
from datetime import timedelta

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.config import get_settings
from app.core.errors import BadRequest, Conflict, NotFound
from app.core.logging import get_logger
from app.core.timeutil import utcnow
from app.models import Device, Invite, Medicine, Patient, PatientCaregiver, ReferenceImage, Scan, User
from app.realtime.publisher import publish, publish_user
from app.repositories import devices as device_repo
from app.repositories import medicines as med_repo
from app.repositories import patients as patient_repo
from app.schemas.patient import DeviceOut, DevicePair, PatientCreate, PatientUpdate, SlotOut

log = get_logger(__name__)

# No 0/O/1/I so codes are easy to read aloud and type.
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
INVITE_DAYS = 7


async def create_patient(db: AsyncSession, user: User, data: PatientCreate) -> Patient:
    patient = Patient(display_name=data.display_name.strip(), note=data.note)
    db.add(patient)
    await db.flush()
    db.add(PatientCaregiver(patient_id=patient.id, user_id=user.id, role="owner"))
    await db.commit()
    await publish_user(user.id, "patients.changed")
    return patient


async def update_patient(db: AsyncSession, patient_id: int, data: PatientUpdate) -> Patient:
    patient = await db.get(Patient, patient_id)
    assert patient is not None
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(patient, k, v)
    await db.commit()
    await publish(patient_id, "patient.updated")
    return patient


async def _patient_files(db: AsyncSession, patient_id: int) -> list[str]:
    scans = (await db.scalars(select(Scan.image_path).where(Scan.patient_id == patient_id))).all()
    refs = (
        await db.scalars(
            select(ReferenceImage.path)
            .join(Medicine, Medicine.id == ReferenceImage.medicine_id)
            .where(Medicine.patient_id == patient_id)
        )
    ).all()
    return [*scans, *refs]


async def delete_patient(db: AsyncSession, patient_id: int) -> None:
    """Deletes the patient and every row (cascade) and file that belongs to it."""
    files = await _patient_files(db, patient_id)
    await db.execute(delete(Patient).where(Patient.id == patient_id))
    await db.commit()
    for rel in files:
        await run_in_threadpool(storage.delete, rel)
    log.info("patient_deleted", patient_id=patient_id, files=len(files))


async def leave_patient(db: AsyncSession, user: User, patient_id: int) -> None:
    if await patient_repo.caregiver_count(db, patient_id) <= 1:
        await delete_patient(db, patient_id)
        return
    link = await patient_repo.link(db, user.id, patient_id)
    if link and link.role == "owner":
        # Hand ownership to the longest-standing remaining caregiver.
        others = [u for u, _ in await patient_repo.caregivers(db, patient_id) if u.id != user.id]
        heir = await patient_repo.link(db, others[0].id, patient_id)
        assert heir is not None
        heir.role = "owner"
    await db.execute(
        delete(PatientCaregiver).where(PatientCaregiver.patient_id == patient_id, PatientCaregiver.user_id == user.id)
    )
    await db.commit()
    await publish(patient_id, "patient.updated")


async def create_invite(db: AsyncSession, user: User, patient_id: int) -> Invite:
    for _ in range(5):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        invite = Invite(
            patient_id=patient_id, code=code, created_by=user.id, expires_at=utcnow() + timedelta(days=INVITE_DAYS)
        )
        db.add(invite)
        try:
            await db.commit()
            return invite
        except IntegrityError:
            await db.rollback()
    raise Conflict("invite_failed", "Could not create a code. Try again.")


async def accept_invite(db: AsyncSession, user: User, code: str) -> Patient:
    invite = await db.scalar(select(Invite).where(Invite.code == code.strip().upper()).with_for_update())
    if invite is None or invite.used_at is not None or invite.expires_at < utcnow():
        raise BadRequest("invite_invalid", "That code is not valid or has expired. Ask for a new one.")
    patient = await db.get(Patient, invite.patient_id)
    assert patient is not None
    if await patient_repo.link(db, user.id, patient.id) is None:
        db.add(PatientCaregiver(patient_id=patient.id, user_id=user.id, role="member"))
    invite.used_by, invite.used_at = user.id, utcnow()
    await db.commit()
    await publish(patient.id, "patient.updated")
    await publish_user(user.id, "patients.changed")
    return patient


async def pair_device(db: AsyncSession, patient_id: int, data: DevicePair) -> Device:
    camera_id = data.camera_id or f"{data.device_id}-cam"
    if data.device_id == camera_id:
        raise BadRequest("invalid_device", "The pillbox and camera codes must be different.")
    existing = await device_repo.for_patient(db, patient_id)
    clash = await device_repo.by_any_id(db, data.device_id) or await device_repo.by_any_id(db, camera_id)
    if clash and clash.patient_id != patient_id:
        raise Conflict("device_taken", "This pillbox is already paired with another person.")
    if existing:
        existing.device_id, existing.camera_id = data.device_id, camera_id
        device = existing
    else:
        device = Device(patient_id=patient_id, device_id=data.device_id, camera_id=camera_id, slot_state={})
        db.add(device)
    await db.commit()
    await publish(patient_id, "device.updated")
    log.info("device_paired", patient_id=patient_id)
    return device


async def unpair_device(db: AsyncSession, patient_id: int) -> None:
    await db.execute(delete(Device).where(Device.patient_id == patient_id))
    await db.commit()
    await publish(patient_id, "device.updated")


def is_online(device: Device) -> bool:
    if device.last_seen is None:
        return False
    return (utcnow() - device.last_seen).total_seconds() <= get_settings().online_window_seconds


async def device_status(db: AsyncSession, patient_id: int) -> DeviceOut:
    device = await device_repo.for_patient(db, patient_id)
    if device is None:
        raise NotFound("no_device", "No pillbox is paired yet.")
    meds = {m.slot: m for m in await med_repo.list_for_patient(db, patient_id) if m.slot}
    state = device.slot_state or {}
    slots = []
    for n in range(1, 6):
        s = state.get(str(n), {})
        m = meds.get(n)
        slots.append(
            SlotOut(
                slot=n,
                medicine_id=m.id if m else None,
                medicine_name=m.label if m else None,
                lid_open=s.get("lidOpen"),
                last_event_at=s.get("at"),
            )
        )
    return DeviceOut(
        device_id=device.device_id,
        camera_id=device.camera_id,
        status="online" if is_online(device) else "offline",
        last_seen=device.last_seen,
        camera_last_seen=device.camera_last_seen,
        slots=slots,
    )


async def delete_account(db: AsyncSession, user: User) -> None:
    """Delete on request: the user, their tokens and alerts, and patients nobody else looks after."""
    for patient, _role in await patient_repo.for_user(db, user.id):
        await leave_patient(db, user, patient.id)
    await db.execute(delete(User).where(User.id == user.id))
    await db.commit()
    log.info("account_deleted", user_id=user.id)
