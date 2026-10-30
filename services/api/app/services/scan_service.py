"""POST /api/scan behaviour (contract: answer < 10 s) and scan review/correction for the app."""

from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.config import get_settings
from app.core.errors import TooLarge, UnsupportedMedia
from app.core.logging import get_logger
from app.core.text import fit
from app.core.timeutil import device_today, utcnow
from app.models import Medicine, Patient, Scan
from app.realtime.publisher import publish
from app.repositories import medicines as med_repo
from app.schemas.device import SCAN_LIMITS, ScanFound
from app.services import alert_service, device_service
from app.vision import pipeline

log = get_logger(__name__)


def scan_answer(med: Medicine) -> ScanFound:
    return ScanFound(
        found=True,
        name=fit(med.label, SCAN_LIMITS["name"]),
        dose=fit(device_service.dose_text(med), SCAN_LIMITS["dose"]),
        instructions=fit(med.instructions, SCAN_LIMITS["instructions"]),
        expiry=device_service.expiry_text(med)[: SCAN_LIMITS["expiry"]],
        slot=med.slot or 0,
        qty=max(0, med.qty),
        low=med.qty <= med.low_stock_threshold,
        expired=bool(med.expiry_date and med.expiry_date < device_today()),
    )


def check_image(data: bytes, content_type: str | None) -> None:
    if len(data) > get_settings().scan_max_bytes:
        raise TooLarge(message="Image is larger than 4 MB.")
    ctype = (content_type or "").split(";")[0].strip().lower()
    if ctype not in ("image/jpeg", "image/jpg") or not storage.is_jpeg(data):
        raise UnsupportedMedia(message="Send a JPEG image with Content-Type: image/jpeg.")


async def scan(db: AsyncSession, device_ident: str | None, data: bytes, content_type: str | None) -> dict:
    device = await device_service.resolve(db, device_ident)
    check_image(data, content_type)
    await device_service.heartbeat(db, device, camera=True)
    now = utcnow()
    rel = storage.new_rel_path("scans", now)
    await run_in_threadpool(storage.write_bytes, rel, data)

    meds = await med_repo.list_for_patient(db, device.patient_id)
    candidates = [
        pipeline.Candidate(id=m.id, label=m.label, barcode=m.barcode, name=m.name, strength=m.strength) for m in meds
    ]
    ids = [m.id for m in meds]

    async def lookup(vec: list[float]) -> list[tuple[int, float]]:
        return await med_repo.nearest_references(db, ids, vec)

    match = await pipeline.identify(data, candidates, lookup)
    med = next((m for m in meds if m.id == match.medicine_id), None)
    answer: dict = scan_answer(med).model_dump() if med else {"found": False}

    row = Scan(
        patient_id=device.patient_id,
        device_id=device.camera_id,
        image_path=rel,
        found=med is not None,
        method=match.method,
        score=match.score,
        medicine_id=med.id if med else None,
        result=answer,
        ocr_expiry=match.ocr_expiry,
        timings=match.timings,
        duration_ms=match.timings.get("total", 0),
        created_at=now,
    )
    db.add(row)
    await db.flush()
    created = alert_service.Created()
    if med is None:
        patient = await db.get(Patient, device.patient_id)
        assert patient is not None
        created = await alert_service.scan_unknown(db, patient, row.id)
    await db.commit()
    await publish(device.patient_id, "scan.created", {"scanId": row.id})
    await alert_service.dispatch(created)
    log.info(
        "scan_done",
        scan_id=row.id,
        method=match.method,
        score=match.score,
        **{f"ms_{k}": v for k, v in match.timings.items()},
    )
    return answer
