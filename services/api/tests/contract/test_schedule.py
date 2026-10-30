"""GET /api/schedule?device=pillbox: frozen ESP32 contract."""

from datetime import time

from sqlalchemy import select

from app.models import Device
from app.schemas.device import MAX_DOSES
from tests.factories import make_medicine, make_patient, make_schedule, make_user, pair_device

DOSE_KEYS = {"id", "slot", "name", "dose", "time", "instructions", "expiry", "qty"}


async def get_schedule(client, device="pillbox"):
    return await client.get("/api/schedule", params={"device": device})


async def test_shape_and_types(client, setup):
    r = await get_schedule(client)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"doses"}
    assert len(body["doses"]) == 4
    for d in body["doses"]:
        assert set(d) == DOSE_KEYS
        assert isinstance(d["id"], int) and isinstance(d["slot"], int) and isinstance(d["qty"], int)
        assert 1 <= d["slot"] <= 5
        assert len(d["time"]) == 5 and d["time"][2] == ":"
        assert all(isinstance(d[k], str) for k in ("name", "dose", "time", "instructions", "expiry"))


async def test_exact_example_entry(client, setup):
    los = setup["scheds"]["losartan"]
    doses = (await get_schedule(client)).json()["doses"]
    entry = next(d for d in doses if d["id"] == los.id)
    assert entry == {
        "id": los.id,
        "slot": 1,
        "name": "Losartan 50mg",
        "dose": "1 tablet",
        "time": "08:00",
        "instructions": "After breakfast",
        "expiry": "2027-06-30",
        "qty": 24,
    }


async def test_one_entry_per_dose_time_sorted(client, setup):
    doses = (await get_schedule(client)).json()["doses"]
    assert [(d["time"], d["slot"]) for d in doses] == [("08:00", 1), ("08:00", 2), ("13:00", 3), ("20:00", 2)]
    met_ids = {setup["scheds"]["met_am"].id, setup["scheds"]["met_pm"].id}
    assert {d["id"] for d in doses if d["slot"] == 2} == met_ids


async def test_ids_stable_across_calls_and_time_edit(client, db, setup):
    first = [d["id"] for d in (await get_schedule(client)).json()["doses"]]
    second = [d["id"] for d in (await get_schedule(client)).json()["doses"]]
    assert first == second
    sched = setup["scheds"]["amlodipine"]
    sched.time = time(6, 30)
    await db.commit()
    doses = (await get_schedule(client)).json()["doses"]
    moved = next(d for d in doses if d["slot"] == 3)
    assert moved["id"] == sched.id and moved["time"] == "06:30"
    assert set(first) == {d["id"] for d in doses}


async def test_only_today_inactive_and_unslotted_excluded(client, db, setup):
    patient = setup["patient"]
    # Frozen today is Friday (weekday 4).
    not_today = await make_medicine(db, patient, name="Weekly", slot=4)
    await make_schedule(db, not_today, time(9, 0), days=[0])
    unslotted = await make_medicine(db, patient, name="Spare", slot=None)
    await make_schedule(db, unslotted, time(9, 0))
    inactive_sched = await make_medicine(db, patient, name="Paused", slot=5)
    await make_schedule(db, inactive_sched, time(9, 0), active=False)
    await db.commit()
    doses = (await get_schedule(client)).json()["doses"]
    assert len(doses) == 4
    assert {d["slot"] for d in doses} == {1, 2, 3}


async def test_inactive_medicine_excluded(client, db, setup):
    setup["meds"]["amlodipine"].active = False
    await db.commit()
    doses = (await get_schedule(client)).json()["doses"]
    assert 3 not in {d["slot"] for d in doses}


async def test_max_20_doses(client, db, setup):
    med = setup["meds"]["losartan"]
    for minute in range(25):
        await make_schedule(db, med, time(10, minute))
    await db.commit()
    doses = (await get_schedule(client)).json()["doses"]
    assert len(doses) == MAX_DOSES
    assert doses == sorted(doses, key=lambda d: (d["time"], d["slot"]))


async def test_text_limits(client, db, setup):
    med = setup["meds"]["losartan"]
    med.name = "Hydrochlorothiazide Extended Release"
    med.strength = "12.5mg"
    med.instructions = "Take with a full glass of water after breakfast, do not crush"
    med.dose_amount = 2
    med.dose_unit = "capsule"
    await db.commit()
    d = next(x for x in (await get_schedule(client)).json()["doses"] if x["slot"] == 1)
    assert len(d["name"]) <= 23 and d["name"] == "Hydrochlorothiazide"
    assert len(d["instructions"]) <= 39 and d["instructions"] == "Take with a full glass of water after"
    assert d["dose"] == "2 capsules" and len(d["dose"]) <= 15
    assert len(d["expiry"]) == 10


async def test_text_at_limit_unchanged_and_multibyte_ascii(client, db, setup):
    med = setup["meds"]["losartan"]
    med.name, med.strength = "A" * 23, None
    med.instructions = "Pagkatapos kumain — señora’s dose"
    await db.commit()
    d = next(x for x in (await get_schedule(client)).json()["doses"] if x["slot"] == 1)
    assert d["name"] == "A" * 23
    assert d["instructions"] == "Pagkatapos kumain - senora's dose"
    assert d["instructions"].isascii()
    med.name = "A" * 24
    await db.commit()
    d = next(x for x in (await get_schedule(client)).json()["doses"] if x["slot"] == 1)
    assert d["name"] == "A" * 23


async def test_missing_expiry_is_empty_string(client, db, setup):
    setup["meds"]["losartan"].expiry_date = None
    await db.commit()
    d = next(x for x in (await get_schedule(client)).json()["doses"] if x["slot"] == 1)
    assert d["expiry"] == ""


async def test_qty_is_current_and_never_negative(client, db, setup):
    setup["meds"]["losartan"].qty = 0
    await db.commit()
    d = next(x for x in (await get_schedule(client)).json()["doses"] if x["slot"] == 1)
    assert d["qty"] == 0


async def test_empty_schedule(client, db):
    user = await make_user(db)
    patient = await make_patient(db, user)
    await pair_device(db, patient, "pillbox2")
    await db.commit()
    r = await get_schedule(client, "pillbox2")
    assert r.status_code == 200 and r.json() == {"doses": []}


async def test_heartbeat_updates_last_seen(client, db, setup):
    assert setup["device"].last_seen is None
    await get_schedule(client)
    seen = await db.scalar(select(Device.last_seen).where(Device.device_id == "pillbox"))
    assert seen is not None


async def test_unknown_device_403(client, setup):
    r = await get_schedule(client, "stranger")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "device_not_registered"


async def test_camera_id_is_also_known(client, setup):
    r = await get_schedule(client, "pillbox-cam")
    assert r.status_code == 200


async def test_missing_device_422(client, setup):
    r = await client.get("/api/schedule")
    assert r.status_code == 422


async def test_only_own_patient_doses(client, db, setup):
    other_user = await make_user(db)
    other = await make_patient(db, other_user)
    await pair_device(db, other, "pillbox9")
    med = await make_medicine(db, other, name="Other")
    await make_schedule(db, med, time(7, 0))
    await db.commit()
    ids = {d["id"] for d in (await get_schedule(client)).json()["doses"]}
    assert ids == {s.id for s in setup["scheds"].values()}


async def test_rate_limited(client, setup):
    codes = [(await get_schedule(client)).status_code for _ in range(31)]
    assert codes[-1] == 429 and codes[0] == 200
