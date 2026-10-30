"""Scan pipeline with the real models (marked `vision`), the 10 s budget, and scan review/correction."""

import asyncio
import time
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.models import ReferenceImage, Scan
from app.vision import pipeline, stages
from tests.conftest import auth_headers
from tests.imaging import jpeg, package

SAMPLES = Path(__file__).resolve().parent.parent / "vision_samples"


@pytest.fixture(scope="session")
def vision_models():
    from app.vision import models

    models.load_all()
    yield


async def scan(client, data: bytes):
    return await client.post("/api/scan", content=data, headers={"Content-Type": "image/jpeg", "X-Device": "pillbox-cam"})


@pytest.mark.vision
async def test_label_text_identified_under_10s(client, setup, vision_models):
    data = (SAMPLES / "Metformin" / "text_only.jpg").read_bytes()
    t0 = time.monotonic()
    r = await scan(client, data)
    elapsed = time.monotonic() - t0
    assert r.status_code == 200 and elapsed < 10
    body = r.json()
    assert body["found"] is True and body["name"] == "Metformin 500mg" and body["low"] is True


@pytest.mark.vision
async def test_unknown_package_not_found_under_10s(client, setup, vision_models):
    t0 = time.monotonic()
    r = await scan(client, (SAMPLES / "none" / "cetirizine.jpg").read_bytes())
    assert time.monotonic() - t0 < 10
    assert r.json() == {"found": False}


async def test_slow_stage_still_answers_in_budget(client, db, setup, monkeypatch):
    """A stage that hangs must not push the answer past the camera's limit."""

    async def hang(*_args):
        await asyncio.sleep(30)

    monkeypatch.setattr(stages, "extra_stages", lambda: iter([("ocr", hang)]))
    monkeypatch.setattr(pipeline, "STAGE_MIN", {**pipeline.STAGE_MIN, "ocr": 0.1})
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "scan_budget_seconds", 2.0)
    t0 = time.monotonic()
    r = await scan(client, jpeg(package("Mystery", "")))
    assert time.monotonic() - t0 < 4
    assert r.json() == {"found": False}
    row = await db.scalar(select(Scan))
    assert row is not None and row.found is False  # saved even when the budget ran out


async def test_stage_skipped_when_budget_left_is_too_small(monkeypatch):
    called = []

    async def stage(*_args):
        called.append(1)

    monkeypatch.setattr(stages, "extra_stages", lambda: iter([("llm", stage)]))
    result = await pipeline.identify(jpeg(package("X", "")), [pipeline.Candidate(1, "X")], budget=1.0)
    assert called == [] and result.timings["llm"] == -1


async def test_scans_list_image_and_correction(client, db, setup):
    h = auth_headers(setup["user"])
    pid = setup["patient"].id
    await scan(client, jpeg(package("Mystery", "")))
    page = (await client.get(f"/api/v1/patients/{pid}/scans", headers=h)).json()
    assert page["total"] == 1
    item = page["items"][0]
    assert item["found"] is False and item["medicineName"] is None
    img = await client.get(item["imageUrl"], headers=h)
    assert img.status_code == 200 and img.content[:3] == b"\xff\xd8\xff"

    los = setup["meds"]["losartan"]
    r = await client.post(f"/api/v1/patients/{pid}/scans/{item['id']}/correct", json={"medicineId": los.id}, headers=h)
    assert r.status_code == 200
    assert r.json()["correctedMedicineId"] == los.id and r.json()["correctedAt"]
    refs = await db.scalar(
        select(func.count()).select_from(ReferenceImage).where(
            ReferenceImage.medicine_id == los.id, ReferenceImage.angle == "correction"
        )
    )
    assert refs == 1
    r = await client.post(f"/api/v1/patients/{pid}/scans/{item['id']}/correct", json={"medicineId": None}, headers=h)
    assert r.json()["correctedNone"] is True


async def test_scans_are_private(client, db, setup):
    from tests.factories import make_user

    stranger = await make_user(db)
    await db.commit()
    await scan(client, jpeg(package("Mystery", "")))
    sid = await db.scalar(select(Scan.id))
    pid = setup["patient"].id
    h = auth_headers(stranger)
    assert (await client.get(f"/api/v1/patients/{pid}/scans", headers=h)).status_code == 404
    assert (await client.get(f"/api/v1/patients/{pid}/scans/{sid}/image", headers=h)).status_code == 404
