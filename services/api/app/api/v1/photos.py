from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse

from app.api.deps import CurrentUser, DbSession, require_patient
from app.core import storage
from app.core.errors import NotFound
from app.schemas.medicine import PhotoOut
from app.repositories import medicines as med_repo
from app.services import medicine_service, reference_service

router = APIRouter(prefix="/patients/{patient_id}/medicines/{medicine_id}/photos", tags=["medicines"])


def _out(patient_id: int, medicine_id: int, ref) -> PhotoOut:
    return PhotoOut(
        id=ref.id, angle=ref.angle, url=reference_service.photo_url(patient_id, medicine_id, ref.id),
        created_at=ref.created_at,
    )


@router.get("", response_model=list[PhotoOut])
async def list_photos(patient_id: int, medicine_id: int, user: CurrentUser, db: DbSession) -> list[PhotoOut]:
    await require_patient(db, user, patient_id)
    med = await medicine_service.get(db, patient_id, medicine_id)
    return [_out(patient_id, med.id, r) for r in await med_repo.reference_images(db, med.id)]


@router.post("", response_model=PhotoOut, status_code=201)
async def add_photo(
    patient_id: int,
    medicine_id: int,
    user: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),
    angle: str = Form("front"),
) -> PhotoOut:
    await require_patient(db, user, patient_id)
    med = await medicine_service.get(db, patient_id, medicine_id)
    data = await file.read(reference_service.MAX_UPLOAD + 1)
    ref = await reference_service.add_photo(db, med, data, angle)
    return _out(patient_id, med.id, ref)


@router.get("/{photo_id}/image", response_class=FileResponse)
async def photo_image(patient_id: int, medicine_id: int, photo_id: int, user: CurrentUser, db: DbSession):
    await require_patient(db, user, patient_id)
    med = await med_repo.get(db, patient_id, medicine_id)
    if med is None:
        raise NotFound("not_found", "Photo not found.")
    ref = await reference_service.get_photo(db, med, photo_id)
    path = storage.root() / ref.path
    if not path.exists():
        raise NotFound("not_found", "Photo not found.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@router.delete("/{photo_id}", status_code=204)
async def delete_photo(patient_id: int, medicine_id: int, photo_id: int, user: CurrentUser, db: DbSession) -> None:
    await require_patient(db, user, patient_id)
    med = await medicine_service.get(db, patient_id, medicine_id)
    await reference_service.delete_photo(db, med, photo_id)
