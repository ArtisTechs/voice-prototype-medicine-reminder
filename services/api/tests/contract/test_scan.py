"""POST /api/scan: frozen ESP32 contract (shape, limits, flags, errors, < 10 s, image saved)."""

import time
from pathlib import Path

from sqlalchemy import select

from app.core.config import get_settings
from app.models import Alert, Scan
from tests.imaging import jpeg, package

FOUND_KEYS = {"found", "name", "dose", "instructions", "expiry", "slot", "qty", "low", "expired"}


async def scan(client, data: bytes, device="pillbox-cam", ctype="image/jpeg"):
    return await client.post("/api/scan", content=data, headers={"Content-Type": ctype, "X-Device": device})


def photo(code: str | None, name="Losartan", strength="50mg") -> bytes:
    return jpeg(package(name, strength, code=code))


async def test_found_shape_and_values(client, setup):
    t0 = time.monotonic()
    r = await scan(client, photo("4800123456786"))
    elapsed = time.monotonic() - t0
    assert r.status_code == 200
    body = r.json()
    assert set(body) == FOUND_KEYS
    assert body == {
        "found": True,
        "name": "Losartan 50mg",
        "dose": "1 tablet",
        "instructions": "After breakfast",
        "expiry": "2027-06-30",
        "slot": 1,
        "qty": 24,
        "low": False,
        "expired": False,
    }
    assert elapsed < 10


async def test_not_found_is_exactly_found_false(client, setup):
    r = await scan(client, photo(None, "Mystery", ""))
    assert r.status_code == 200
    assert r.json() == {"found": False}


async def test_low_flag(client, setup):
    body = (await scan(client, photo("4800987654328", "Metformin", "500mg"))).json()
    assert body["found"] is True and body["low"] is True and body["qty"] == 4 and body["slot"] == 2


async def test_expired_flag(client, db, setup):
    amlo = setup["meds"]["amlodipine"]
    amlo.barcode = "4800555123454"
    await db.commit()
    body = (await scan(client, photo("4800555123454", "Amlodipine", "5mg"))).json()
    assert body["expired"] is True and body["expiry"] == "2026-09-30"


async def test_slot_zero_when_unassigned(client, db, setup):
    los = setup["meds"]["losartan"]
    los.slot = None
    await db.commit()
    body = (await scan(client, photo("4800123456786"))).json()
    assert body["found"] is True and body["slot"] == 0


async def test_text_limits(client, db, setup):
    los = setup["meds"]["losartan"]
    los.name = "Losartan Potassium Film-Coated Tablets"
    los.instructions = "Take one tablet every morning after breakfast with a full glass of water please"
    los.dose_unit = "film-coated tablet"
    los.dose_amount = 2
    await db.commit()
    body = (await scan(client, photo("4800123456786"))).json()
    assert len(body["name"]) <= 31 and body["name"].isascii()
    assert len(body["dose"]) <= 19
    assert len(body["instructions"]) <= 63
    assert body["name"] == "Losartan Potassium Film-Coated"


async def test_image_saved_with_result(client, db, setup):
    await scan(client, photo("4800123456786"))
    row = await db.scalar(select(Scan))
    assert row.found is True and row.method == "barcode"
    assert row.medicine_id == setup["meds"]["losartan"].id
    assert row.result["name"] == "Losartan 50mg"
    assert (Path(get_settings().scan_dir) / row.image_path).exists()


async def test_unknown_scan_alerts(client, db, setup):
    await scan(client, photo(None, "Mystery", ""))
    assert len(list((await db.scalars(select(Alert).where(Alert.type == "scan_unknown"))).all())) == 1


async def test_non_jpeg_415(client, setup):
    r = await scan(client, b"\x89PNG\r\n\x1a\n" + b"0" * 100, ctype="image/png")
    assert r.status_code == 415
    r = await scan(client, b"not a jpeg", ctype="image/jpeg")
    assert r.status_code == 415


async def test_too_large_413(client, setup):
    r = await scan(client, b"\xff\xd8\xff" + b"0" * (4 * 1024 * 1024 + 10))
    assert r.status_code == 413


async def test_unknown_device_403(client, setup):
    r = await scan(client, photo("4800123456786"), device="stranger-cam")
    assert r.status_code == 403


async def test_missing_device_header_403(client, setup):
    r = await client.post("/api/scan", content=photo(None), headers={"Content-Type": "image/jpeg"})
    assert r.status_code == 403


async def test_other_patients_medicine_never_matched(client, db, setup):
    from tests.factories import make_medicine, make_patient, make_user

    other = await make_patient(db, await make_user(db))
    await make_medicine(db, other, name="Secret", barcode="4801111111113")
    await db.commit()
    assert (await scan(client, photo("4801111111113", "Secret", ""))).json() == {"found": False}
