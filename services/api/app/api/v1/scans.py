from datetime import datetime

from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, require_patient
from app.core import storage
from app.core.errors import NotFound
from app.core.timeutil import utcnow
from app.models import Medicine, Scan
from app.realtime.publisher import publish
from app.schemas.common import ApiModel, Page
from app.services import medicine_service, reference_service

router = APIRouter(prefix="/patients/{patient_id}/scans", tags=["scans"])


class ScanOut(ApiModel):
    id: int
    found: bool
    method: str
    score: float | None
    medicine_id: int | None
    medicine_name: str | None
    corrected_medicine_id: int | None
    corrected_none: bool
    corrected_at: datetime | None
    ocr_expiry: str | None
    duration_ms: int
    image_url: str
    created_at: datetime


class CorrectIn(ApiModel):
    medicine_id: int | None


def _out(scan: Scan, names: dict[int, str]) -> ScanOut:
    return ScanOut(
        id=scan.id,
        found=scan.found,
        method=scan.method,
        score=scan.score,
        medicine_id=scan.medicine_id,
        medicine_name=names.get(scan.medicine_id) if scan.medicine_id else None,
        corrected_medicine_id=scan.corrected_medicine_id,
        corrected_none=scan.corrected_none,
        corrected_at=scan.corrected_at,
        ocr_expiry=scan.ocr_expiry,
        duration_ms=scan.duration_ms,
        image_url=f"/api/v1/patients/{scan.patient_id}/scans/{scan.id}/image",
        created_at=scan.created_at,
    )


async def _names(db, patient_id: int) -> dict[int, str]:
    return {m.id: m.label for m in await db.scalars(select(Medicine).where(Medicine.patient_id == patient_id))}


async def _get(db, patient_id: int, scan_id: int) -> Scan:
    scan = await db.scalar(select(Scan).where(Scan.id == scan_id, Scan.patient_id == patient_id))
    if scan is None:
        raise NotFound("not_found", "Scan not found.")
    return scan


@router.get("", response_model=Page[ScanOut])
async def list_scans(
    patient_id: int,
    user: CurrentUser,
    db: DbSession,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Page[ScanOut]:
    await require_patient(db, user, patient_id)
    q = select(Scan).where(Scan.patient_id == patient_id)
    total = await db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = (await db.scalars(q.order_by(Scan.created_at.desc(), Scan.id.desc()).limit(limit).offset(offset))).all()
    names = await _names(db, patient_id)
    return Page[ScanOut](items=[_out(s, names) for s in rows], total=total, limit=limit, offset=offset)


@router.get("/{scan_id}/image", response_class=FileResponse)
async def scan_image(patient_id: int, scan_id: int, user: CurrentUser, db: DbSession):
    await require_patient(db, user, patient_id)
    scan = await _get(db, patient_id, scan_id)
    path = storage.root() / scan.image_path
    if not path.exists():
        raise NotFound("not_found", "The photo was deleted.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@router.post("/{scan_id}/correct", response_model=ScanOut)
async def correct_scan(patient_id: int, scan_id: int, body: CorrectIn, user: CurrentUser, db: DbSession) -> ScanOut:
    """Set the right medicine (or none). A medicine answer is added as a new reference photo."""
    await require_patient(db, user, patient_id)
    scan = await _get(db, patient_id, scan_id)
    scan.corrected_at = utcnow()
    scan.corrected_none = body.medicine_id is None
    scan.corrected_medicine_id = body.medicine_id
    if body.medicine_id is not None:
        med = await medicine_service.get(db, patient_id, body.medicine_id)
        try:
            data = await run_in_threadpool(storage.read_bytes, scan.image_path)
        except FileNotFoundError as e:
            raise NotFound("not_found", "The photo was deleted, so it cannot be learned from.") from e
        await reference_service.add_photo(db, med, data, "correction", commit=False)
    await db.commit()
    await publish(patient_id, "scan.created", {"scanId": scan.id})
    return _out(scan, await _names(db, patient_id))
