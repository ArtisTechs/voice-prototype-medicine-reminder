from datetime import timedelta
from pathlib import Path

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.timeutil import utcnow
from app.models import Device, Invite, Medicine, Patient, Scan, User
from tests.conftest import auth_headers
from tests.factories import make_medicine, make_patient, make_user, pair_device


async def test_create_and_list_patients(client, db):
    user = await make_user(db)
    await db.commit()
    h = auth_headers(user)
    r = await client.post("/api/v1/patients", json={"displayName": "Lolo Ben"}, headers=h)
    assert r.status_code == 201 and r.json()["role"] == "owner"
    lst = (await client.get("/api/v1/patients", headers=h)).json()
    assert [p["displayName"] for p in lst] == ["Lolo Ben"]


async def test_other_caregiver_gets_404_everywhere(client, db):
    owner, stranger = await make_user(db), await make_user(db)
    patient = await make_patient(db, owner)
    med = await make_medicine(db, patient)
    await pair_device(db, patient)
    await db.commit()
    h = auth_headers(stranger)
    pid = patient.id
    for method, path in [
        ("GET", f"/api/v1/patients/{pid}"),
        ("PATCH", f"/api/v1/patients/{pid}"),
        ("GET", f"/api/v1/patients/{pid}/medicines"),
        ("GET", f"/api/v1/patients/{pid}/medicines/{med.id}"),
        ("PATCH", f"/api/v1/patients/{pid}/medicines/{med.id}"),
        ("DELETE", f"/api/v1/patients/{pid}/medicines/{med.id}"),
        ("GET", f"/api/v1/patients/{pid}/device"),
        ("POST", f"/api/v1/patients/{pid}/invites"),
        ("GET", f"/api/v1/patients/{pid}/caregivers"),
        ("DELETE", f"/api/v1/patients/{pid}"),
    ]:
        r = await client.request(method, path, headers=h, json={} if method in ("PATCH",) else None)
        assert r.status_code == 404, (method, path, r.status_code)


async def test_invite_flow(client, db):
    owner, helper = await make_user(db), await make_user(db)
    patient = await make_patient(db, owner)
    await db.commit()
    r = await client.post(f"/api/v1/patients/{patient.id}/invites", headers=auth_headers(owner))
    assert r.status_code == 201
    code = r.json()["code"]
    assert len(code) == 6 and not set(code) & set("01OI")
    acc = await client.post("/api/v1/invites/accept", json={"code": code.lower()}, headers=auth_headers(helper))
    assert acc.status_code == 200 and acc.json()["role"] == "member"
    cgs = (await client.get(f"/api/v1/patients/{patient.id}/caregivers", headers=auth_headers(helper))).json()
    assert {c["role"] for c in cgs} == {"owner", "member"}
    third = await make_user(db)
    await db.commit()
    used = await client.post("/api/v1/invites/accept", json={"code": code}, headers=auth_headers(third))
    assert used.status_code == 400 and used.json()["error"]["code"] == "invite_invalid"


async def test_expired_invite_rejected(client, db):
    owner, helper = await make_user(db), await make_user(db)
    patient = await make_patient(db, owner)
    db.add(Invite(patient_id=patient.id, code="ABCDEF", created_by=owner.id, expires_at=utcnow() - timedelta(minutes=1)))
    await db.commit()
    r = await client.post("/api/v1/invites/accept", json={"code": "ABCDEF"}, headers=auth_headers(helper))
    assert r.status_code == 400


async def test_member_cannot_delete_patient(client, db):
    owner, helper = await make_user(db), await make_user(db)
    patient = await make_patient(db, owner)
    from app.models import PatientCaregiver

    db.add(PatientCaregiver(patient_id=patient.id, user_id=helper.id, role="member"))
    await db.commit()
    r = await client.delete(f"/api/v1/patients/{patient.id}", headers=auth_headers(helper))
    assert r.status_code == 404


async def test_pair_device_and_status(client, db):
    user = await make_user(db)
    patient = await make_patient(db, user)
    await make_medicine(db, patient, slot=2)
    await db.commit()
    h = auth_headers(user)
    r = await client.put(f"/api/v1/patients/{patient.id}/device", json={"deviceId": "pillbox"}, headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["cameraId"] == "pillbox-cam" and body["status"] == "offline" and body["lastSeen"] is None
    assert [s["slot"] for s in body["slots"]] == [1, 2, 3, 4, 5]
    assert body["slots"][1]["medicineName"] == "Losartan 50mg"
    # A heartbeat from the device makes it online.
    await client.get("/api/schedule", params={"device": "pillbox"})
    status = (await client.get(f"/api/v1/patients/{patient.id}/device", headers=h)).json()
    assert status["status"] == "online" and status["lastSeen"]


async def test_device_offline_after_3_minutes(client, db, frozen):
    user = await make_user(db)
    patient = await make_patient(db, user)
    dev = await pair_device(db, patient)
    dev.last_seen = utcnow() - timedelta(minutes=4)
    await db.commit()
    r = await client.get(f"/api/v1/patients/{patient.id}/device", headers=auth_headers(user))
    assert r.json()["status"] == "offline"


async def test_device_already_paired_elsewhere_409(client, db):
    a, b = await make_user(db), await make_user(db)
    pa, pb = await make_patient(db, a), await make_patient(db, b)
    await pair_device(db, pa, "pillbox")
    await db.commit()
    r = await client.put(f"/api/v1/patients/{pb.id}/device", json={"deviceId": "pillbox"}, headers=auth_headers(b))
    assert r.status_code == 409 and r.json()["error"]["code"] == "device_taken"


async def test_device_id_validation(client, db):
    user = await make_user(db)
    patient = await make_patient(db, user)
    await db.commit()
    r = await client.put(f"/api/v1/patients/{patient.id}/device", json={"deviceId": "pill box!"}, headers=auth_headers(user))
    assert r.status_code == 422


async def test_unpaired_device_rejected_by_firmware_api(client, db):
    user = await make_user(db)
    patient = await make_patient(db, user)
    await pair_device(db, patient)
    await db.commit()
    await client.delete(f"/api/v1/patients/{patient.id}/device", headers=auth_headers(user))
    assert (await client.get("/api/schedule", params={"device": "pillbox"})).status_code == 403


async def test_delete_account_removes_orphaned_patients_and_files(client, db):
    me, other = await make_user(db), await make_user(db)
    mine = await make_patient(db, me)
    shared = await make_patient(db, me)
    from app.models import PatientCaregiver

    db.add(PatientCaregiver(patient_id=shared.id, user_id=other.id, role="member"))
    med = await make_medicine(db, mine)
    await pair_device(db, mine)
    img = Path(get_settings().scan_dir) / "scans/test/delete-me.jpg"
    img.parent.mkdir(parents=True, exist_ok=True)
    img.write_bytes(b"\xff\xd8\xff")
    db.add(Scan(patient_id=mine.id, device_id="pillbox-cam", image_path="scans/test/delete-me.jpg", found=False,
                method="none", duration_ms=1, result={}, timings={}))
    await db.commit()
    r = await client.delete("/api/v1/me", headers=auth_headers(me))
    assert r.status_code == 204
    assert await db.get(User, me.id, populate_existing=True) is None
    assert await db.scalar(select(func.count()).select_from(Patient).where(Patient.id == mine.id)) == 0
    assert await db.scalar(select(func.count()).select_from(Medicine).where(Medicine.id == med.id)) == 0
    assert await db.scalar(select(func.count()).select_from(Device).where(Device.patient_id == mine.id)) == 0
    assert not img.exists()
    # The shared patient survives, now owned by the other caregiver.
    assert await db.scalar(select(func.count()).select_from(Patient).where(Patient.id == shared.id)) == 1
    owners = (await client.get(f"/api/v1/patients/{shared.id}", headers=auth_headers(other))).json()
    assert owners["role"] == "owner"
