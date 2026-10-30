import pytest

from tests.conftest import auth_headers
from tests.factories import make_patient, make_user, pair_device


@pytest.fixture
async def ctx(db):
    user = await make_user(db)
    patient = await make_patient(db, user)
    await pair_device(db, patient)
    await db.commit()
    return {"h": auth_headers(user), "pid": patient.id}


def base(**kw):
    body = {
        "name": "Losartan",
        "strength": "50mg",
        "form": "tablet",
        "doseAmount": 1,
        "doseUnit": "tablet",
        "instructions": "After breakfast",
        "slot": 1,
        "barcode": "4800123456786",
        "expiryDate": "2027-06-30",
        "qty": 24,
        "lowStockThreshold": 5,
        "refillLeadDays": 3,
    }
    body.update(kw)
    return body


async def create(client, ctx, **kw):
    return await client.post(f"/api/v1/patients/{ctx['pid']}/medicines", json=base(**kw), headers=ctx["h"])


async def test_crud(client, ctx):
    r = await create(client, ctx)
    assert r.status_code == 201
    med = r.json()
    assert med["label"] == "Losartan 50mg" and med["lowStock"] is False and med["expired"] is False
    url = f"/api/v1/patients/{ctx['pid']}/medicines/{med['id']}"
    upd = await client.patch(url, json={"qty": 3, "instructions": "  "}, headers=ctx["h"])
    assert upd.status_code == 200
    assert upd.json()["qty"] == 3 and upd.json()["lowStock"] is True and upd.json()["instructions"] is None
    lst = await client.get(f"/api/v1/patients/{ctx['pid']}/medicines", headers=ctx["h"])
    assert len(lst.json()) == 1
    assert (await client.delete(url, headers=ctx["h"])).status_code == 204
    assert (await client.get(url, headers=ctx["h"])).status_code == 404
    assert (await client.get(f"/api/v1/patients/{ctx['pid']}/medicines", headers=ctx["h"])).json() == []


async def test_minimal_create_defaults(client, ctx):
    r = await client.post(f"/api/v1/patients/{ctx['pid']}/medicines", json={"name": "Vitamin C"}, headers=ctx["h"])
    assert r.status_code == 201
    m = r.json()
    assert (m["doseAmount"], m["qty"], m["lowStockThreshold"], m["refillLeadDays"], m["slot"]) == (1, 0, 5, 3, None)


async def test_slot_conflict_409_and_freed_after_delete(client, ctx):
    first = (await create(client, ctx)).json()
    r = await create(client, ctx, name="Other")
    assert r.status_code == 409 and r.json()["error"]["code"] == "slot_taken"
    await client.delete(f"/api/v1/patients/{ctx['pid']}/medicines/{first['id']}", headers=ctx["h"])
    assert (await create(client, ctx, name="Other")).status_code == 201


async def test_validation(client, ctx):
    r = await create(client, ctx, slot=6, doseAmount=0, qty=-1, barcode="<script>", expiryDate="31/12/2027")
    assert r.status_code == 422
    fields = {d["field"] for d in r.json()["error"]["details"]}
    assert {"slot", "doseAmount", "qty", "barcode", "expiryDate"} <= fields


async def test_expired_flag(client, ctx):
    med = (await create(client, ctx, expiryDate="2026-09-30")).json()
    assert med["expired"] is True


async def test_schedules_crud_and_device_schedule(client, ctx):
    med = (await create(client, ctx)).json()
    surl = f"/api/v1/patients/{ctx['pid']}/medicines/{med['id']}/schedules"
    s1 = (await client.post(surl, json={"time": "08:00"}, headers=ctx["h"])).json()
    s2 = (await client.post(surl, json={"time": "20:00", "daysOfWeek": [4, 4, 0]}, headers=ctx["h"])).json()
    assert s1["time"] == "08:00" and s1["daysOfWeek"] == [0, 1, 2, 3, 4, 5, 6]
    assert s2["daysOfWeek"] == [0, 4]
    dup = await client.post(surl, json={"time": "08:00"}, headers=ctx["h"])
    assert dup.status_code == 409
    doses = (await client.get("/api/schedule", params={"device": "pillbox"})).json()["doses"]
    assert [(d["id"], d["time"]) for d in doses] == [(s1["id"], "08:00"), (s2["id"], "20:00")]
    # Edit the time: same id, new time.
    upd = await client.patch(f"{surl}/{s1['id']}", json={"time": "07:30"}, headers=ctx["h"])
    assert upd.json()["id"] == s1["id"] and upd.json()["time"] == "07:30"
    # Not today (frozen Friday = 4) -> leaves the device schedule but is stored.
    await client.patch(f"{surl}/{s2['id']}", json={"daysOfWeek": [0]}, headers=ctx["h"])
    doses = (await client.get("/api/schedule", params={"device": "pillbox"})).json()["doses"]
    assert [d["id"] for d in doses] == [s1["id"]]
    assert (await client.delete(f"{surl}/{s1['id']}", headers=ctx["h"])).status_code == 204
    assert (await client.get("/api/schedule", params={"device": "pillbox"})).json()["doses"] == []
    detail = (await client.get(f"/api/v1/patients/{ctx['pid']}/medicines/{med['id']}", headers=ctx["h"])).json()
    assert [s["id"] for s in detail["schedules"]] == [s2["id"]]


async def test_schedule_validation(client, ctx):
    med = (await create(client, ctx)).json()
    surl = f"/api/v1/patients/{ctx['pid']}/medicines/{med['id']}/schedules"
    assert (await client.post(surl, json={"time": "25:00"}, headers=ctx["h"])).status_code == 422
    assert (await client.post(surl, json={"time": "08:00", "daysOfWeek": [7]}, headers=ctx["h"])).status_code == 422
    assert (await client.post(surl, json={"time": "08:00", "daysOfWeek": []}, headers=ctx["h"])).status_code == 422


async def test_days_left_and_refill_low_stock(client, ctx):
    med = (await create(client, ctx, qty=7, lowStockThreshold=2, refillLeadDays=3)).json()
    surl = f"/api/v1/patients/{ctx['pid']}/medicines/{med['id']}/schedules"
    for t in ("08:00", "20:00"):
        await client.post(surl, json={"time": t}, headers=ctx["h"])
    m = (await client.get(f"/api/v1/patients/{ctx['pid']}/medicines/{med['id']}", headers=ctx["h"])).json()
    assert m["daysLeft"] == 3.5 and m["lowStock"] is False
    m = (await client.patch(f"/api/v1/patients/{ctx['pid']}/medicines/{med['id']}", json={"qty": 6},
                            headers=ctx["h"])).json()
    assert m["daysLeft"] == 3.0 and m["lowStock"] is True
