"""Reference photos of medicine packages (used by the scan matcher's look stage)."""

from pathlib import Path

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.errors import BadRequest, Conflict, NotFound, TooLarge, UnsupportedMedia
from app.core.logging import get_logger
from app.core.timeutil import utcnow
from app.models import Medicine, ReferenceImage
from app.realtime.publisher import publish
from app.vision import embed

log = get_logger(__name__)

MAX_PHOTOS = 12
MAX_UPLOAD = 8 * 1024 * 1024
ANGLES = ("front", "back", "side", "correction", "other")
SEED_ASSETS = Path(__file__).resolve().parent.parent / "seed_assets"


def photo_url(patient_id: int, medicine_id: int, photo_id: int) -> str:
    return f"/api/v1/patients/{patient_id}/medicines/{medicine_id}/photos/{photo_id}/image"


async def add_photo(db: AsyncSession, med: Medicine, data: bytes, angle: str, commit: bool = True) -> ReferenceImage:
    if angle not in ANGLES:
        raise BadRequest("invalid_angle", "Choose front, back or side.")
    if len(data) > MAX_UPLOAD:
        raise TooLarge(message="The photo is larger than 8 MB.")
    if not storage.is_image(data):
        raise UnsupportedMedia(message="Send a JPEG or PNG photo.")
    count = await db.scalar(
        select(func.count()).select_from(ReferenceImage).where(ReferenceImage.medicine_id == med.id)
    )
    if (count or 0) >= MAX_PHOTOS:
        raise Conflict("too_many_photos", f"A medicine can have at most {MAX_PHOTOS} photos. Delete one first.")
    clean = await run_in_threadpool(storage.reencode_jpeg, data)
    rel = storage.new_rel_path("refs", utcnow())
    await run_in_threadpool(storage.write_bytes, rel, clean)
    vector = await run_in_threadpool(embed.embed_bytes, clean)
    ref = ReferenceImage(medicine_id=med.id, angle=angle, path=rel, embedding=vector)
    db.add(ref)
    await db.flush()
    if commit:
        await db.commit()
        await publish(med.patient_id, "medicine.updated", {"medicineId": med.id})
    log.info("reference_added", medicine_id=med.id, embedded=vector is not None)
    return ref


async def get_photo(db: AsyncSession, med: Medicine, photo_id: int) -> ReferenceImage:
    ref = await db.scalar(
        select(ReferenceImage).where(ReferenceImage.id == photo_id, ReferenceImage.medicine_id == med.id)
    )
    if ref is None:
        raise NotFound("not_found", "Photo not found.")
    return ref


async def delete_photo(db: AsyncSession, med: Medicine, photo_id: int) -> None:
    ref = await get_photo(db, med, photo_id)
    path = ref.path
    await db.delete(ref)
    await db.commit()
    await run_in_threadpool(storage.delete, path)
    await publish(med.patient_id, "medicine.updated", {"medicineId": med.id})


async def backfill_embeddings(db: AsyncSession) -> int:
    """Embed reference photos stored before the model was available (startup task)."""
    if not embed.is_loaded():
        return 0
    refs = (await db.scalars(select(ReferenceImage).where(ReferenceImage.embedding.is_(None)))).all()
    for ref in refs:
        try:
            data = await run_in_threadpool(storage.read_bytes, ref.path)
        except FileNotFoundError:
            continue
        ref.embedding = await run_in_threadpool(embed.embed_bytes, data)
    await db.commit()
    if refs:
        log.info("reference_backfill", count=len(refs))
    return len(refs)


async def seed_demo_references(db: AsyncSession) -> None:
    """Attach app/seed_assets/<Medicine name>/*.jpg to the demo medicines that have no photos yet."""
    if not SEED_ASSETS.exists():
        return
    for folder in sorted(p for p in SEED_ASSETS.iterdir() if p.is_dir()):
        meds = (await db.scalars(select(Medicine).where(Medicine.name == folder.name, Medicine.active))).all()
        for med in meds:
            has = await db.scalar(select(func.count()).select_from(ReferenceImage).where(ReferenceImage.medicine_id == med.id))
            if has:
                continue
            for img in sorted(folder.glob("*.jpg")):
                angle = img.stem if img.stem in ANGLES else "other"
                await add_photo(db, med, img.read_bytes(), angle, commit=False)
    await db.commit()
