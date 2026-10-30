from fastapi import APIRouter

from app.api.deps import CurrentUser, DbSession, require_patient
from app.models import Patient
from app.repositories import patients as patient_repo
from app.schemas.patient import (
    CaregiverOut,
    DeviceOut,
    DevicePair,
    InviteAccept,
    InviteOut,
    PatientCreate,
    PatientOut,
    PatientUpdate,
)
from app.services import patient_service

router = APIRouter(tags=["patients"])


def _out(p: Patient, role: str) -> PatientOut:
    return PatientOut(id=p.id, display_name=p.display_name, note=p.note, role=role)


@router.get("/patients", response_model=list[PatientOut])
async def list_patients(user: CurrentUser, db: DbSession) -> list[PatientOut]:
    return [_out(p, r) for p, r in await patient_repo.for_user(db, user.id)]


@router.post("/patients", response_model=PatientOut, status_code=201)
async def create_patient(body: PatientCreate, user: CurrentUser, db: DbSession) -> PatientOut:
    return _out(await patient_service.create_patient(db, user, body), "owner")


@router.get("/patients/{patient_id}", response_model=PatientOut)
async def get_patient(patient_id: int, user: CurrentUser, db: DbSession) -> PatientOut:
    link = await require_patient(db, user, patient_id)
    patient = await db.get(Patient, patient_id)
    return _out(patient, link.role)


@router.patch("/patients/{patient_id}", response_model=PatientOut)
async def update_patient(patient_id: int, body: PatientUpdate, user: CurrentUser, db: DbSession) -> PatientOut:
    link = await require_patient(db, user, patient_id)
    return _out(await patient_service.update_patient(db, patient_id, body), link.role)


@router.delete("/patients/{patient_id}", status_code=204)
async def delete_patient(patient_id: int, user: CurrentUser, db: DbSession) -> None:
    """Owner only: deletes the patient and all their data and photos."""
    await require_patient(db, user, patient_id, owner=True)
    await patient_service.delete_patient(db, patient_id)


@router.post("/patients/{patient_id}/leave", status_code=204)
async def leave_patient(patient_id: int, user: CurrentUser, db: DbSession) -> None:
    await require_patient(db, user, patient_id)
    await patient_service.leave_patient(db, user, patient_id)


@router.get("/patients/{patient_id}/caregivers", response_model=list[CaregiverOut], tags=["invites"])
async def caregivers(patient_id: int, user: CurrentUser, db: DbSession) -> list[CaregiverOut]:
    await require_patient(db, user, patient_id)
    return [CaregiverOut(id=u.id, name=u.name, role=r) for u, r in await patient_repo.caregivers(db, patient_id)]


@router.post("/patients/{patient_id}/invites", response_model=InviteOut, status_code=201, tags=["invites"])
async def create_invite(patient_id: int, user: CurrentUser, db: DbSession) -> InviteOut:
    await require_patient(db, user, patient_id)
    invite = await patient_service.create_invite(db, user, patient_id)
    return InviteOut(code=invite.code, expires_at=invite.expires_at)


@router.post("/invites/accept", response_model=PatientOut, tags=["invites"])
async def accept_invite(body: InviteAccept, user: CurrentUser, db: DbSession) -> PatientOut:
    patient = await patient_service.accept_invite(db, user, body.code)
    link = await patient_repo.link(db, user.id, patient.id)
    return _out(patient, link.role if link else "member")


@router.get("/patients/{patient_id}/device", response_model=DeviceOut, tags=["devices"])
async def get_device(patient_id: int, user: CurrentUser, db: DbSession) -> DeviceOut:
    await require_patient(db, user, patient_id)
    return await patient_service.device_status(db, patient_id)


@router.put("/patients/{patient_id}/device", response_model=DeviceOut, tags=["devices"])
async def pair_device(patient_id: int, body: DevicePair, user: CurrentUser, db: DbSession) -> DeviceOut:
    await require_patient(db, user, patient_id)
    await patient_service.pair_device(db, patient_id, body)
    return await patient_service.device_status(db, patient_id)


@router.delete("/patients/{patient_id}/device", status_code=204, tags=["devices"])
async def unpair_device(patient_id: int, user: CurrentUser, db: DbSession) -> None:
    await require_patient(db, user, patient_id)
    await patient_service.unpair_device(db, patient_id)
