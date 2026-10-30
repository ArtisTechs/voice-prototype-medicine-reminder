from fastapi import APIRouter

from app.api.deps import CurrentUser, DbSession, require_patient
from app.repositories import medicines as med_repo
from app.schemas.medicine import (
    MedicineCreate,
    MedicineOut,
    MedicineUpdate,
    ScheduleIn,
    ScheduleOut,
    ScheduleUpdate,
)
from app.services import medicine_service

router = APIRouter(prefix="/patients/{patient_id}/medicines", tags=["medicines"])


@router.get("", response_model=list[MedicineOut])
async def list_medicines(patient_id: int, user: CurrentUser, db: DbSession) -> list[MedicineOut]:
    await require_patient(db, user, patient_id)
    return [await medicine_service.to_out(db, m) for m in await med_repo.list_for_patient(db, patient_id)]


@router.post("", response_model=MedicineOut, status_code=201)
async def create_medicine(patient_id: int, body: MedicineCreate, user: CurrentUser, db: DbSession) -> MedicineOut:
    await require_patient(db, user, patient_id)
    return await medicine_service.to_out(db, await medicine_service.create(db, patient_id, body))


@router.get("/{medicine_id}", response_model=MedicineOut)
async def get_medicine(patient_id: int, medicine_id: int, user: CurrentUser, db: DbSession) -> MedicineOut:
    await require_patient(db, user, patient_id)
    return await medicine_service.to_out(db, await medicine_service.get(db, patient_id, medicine_id))


@router.patch("/{medicine_id}", response_model=MedicineOut)
async def update_medicine(
    patient_id: int, medicine_id: int, body: MedicineUpdate, user: CurrentUser, db: DbSession
) -> MedicineOut:
    await require_patient(db, user, patient_id)
    return await medicine_service.to_out(db, await medicine_service.update(db, patient_id, medicine_id, body))


@router.delete("/{medicine_id}", status_code=204)
async def delete_medicine(patient_id: int, medicine_id: int, user: CurrentUser, db: DbSession) -> None:
    await require_patient(db, user, patient_id)
    await medicine_service.deactivate(db, patient_id, medicine_id)


@router.post("/{medicine_id}/schedules", response_model=ScheduleOut, status_code=201, tags=["schedules"])
async def add_schedule(
    patient_id: int, medicine_id: int, body: ScheduleIn, user: CurrentUser, db: DbSession
) -> ScheduleOut:
    await require_patient(db, user, patient_id)
    return ScheduleOut.model_validate(await medicine_service.add_schedule(db, patient_id, medicine_id, body))


@router.patch("/{medicine_id}/schedules/{schedule_id}", response_model=ScheduleOut, tags=["schedules"])
async def update_schedule(
    patient_id: int, medicine_id: int, schedule_id: int, body: ScheduleUpdate, user: CurrentUser, db: DbSession
) -> ScheduleOut:
    await require_patient(db, user, patient_id)
    sched = await medicine_service.update_schedule(db, patient_id, medicine_id, schedule_id, body)
    return ScheduleOut.model_validate(sched)


@router.delete("/{medicine_id}/schedules/{schedule_id}", status_code=204, tags=["schedules"])
async def delete_schedule(patient_id: int, medicine_id: int, schedule_id: int, user: CurrentUser, db: DbSession) -> None:
    await require_patient(db, user, patient_id)
    await medicine_service.delete_schedule(db, patient_id, medicine_id, schedule_id)
