"""POST /api/events: frozen ESP32 contract. Every type, idempotency, side effects."""

import json

import pytest
from sqlalchemy import func, select

from app.models import Alert, Device, DeviceEvent, IntakeRecord, Medicine
from app.schemas.device import EVENT_TYPES
from app.services.alert_service import PUSH_QUEUE


def ev(type_, dose_id=0, slot=None, t="2026-10-30T08:00:05", device="pillbox"):
    body = {"device": device, "type": type_, "time": t}
    if dose_id is not None:
        body["doseId"] = dose_id
    if slot is not None:
        body["slot"] = slot
    return body


async def post(client, body):
    return await client.post("/api/events", json=body)


async def intake(db, schedule_id):
    return await db.scalar(
        select(IntakeRecord).where(IntakeRecord.schedule_id == schedule_id).execution_options(populate_existing=True)
    )


async def qty(db, med_id):
    return await db.scalar(select(Medicine.qty).where(Medicine.id == med_id))


async def alerts(db, type_=None):
    q = select(Alert)
    if type_:
        q = q.where(Alert.type == type_)
    return list((await db.scalars(q)).all())


@pytest.mark.parametrize("type_", EVENT_TYPES)
async def test_every_type_accepted_2xx(client, db, setup, type_):
    sid = setup["scheds"]["losartan"].id if type_ in ("due", "taken", "missed", "expired") else 0
    r = await post(client, ev(type_, sid, slot=1))
    assert 200 <= r.status_code < 300
    assert r.json() == {"ok": True}
    n = await db.scalar(select(func.count()).select_from(DeviceEvent).where(DeviceEvent.type == type_))
    assert n == 1


async def test_due_starts_delay_clock(client, db, setup):
    sid = setup["scheds"]["losartan"].id
    await post(client, ev("due", sid, 1, "2026-10-30T08:00:00"))
    rec = await intake(db, sid)
    assert rec.status == "due" and rec.due_at is not None
    assert rec.due_at.isoformat() == "2026-10-30T00:00:00+00:00"


async def test_taken_decrements_qty_and_records_delay(client, db, setup):
    los = setup["meds"]["losartan"]
    sid = setup["scheds"]["losartan"].id
    await post(client, ev("due", sid, 1, "2026-10-30T08:00:00"))
    await post(client, ev("taken", sid, 1, "2026-10-30T08:04:10"))
    rec = await intake(db, sid)
    assert rec.status == "taken" and rec.delay_minutes == 4
    assert await qty(db, los.id) == 23


async def test_taken_uses_dose_amount(client, db, setup):
    los = setup["meds"]["losartan"]
    los.dose_amount = 2
    await db.commit()
    await post(client, ev("taken", setup["scheds"]["losartan"].id, 1))
    assert await qty(db, los.id) == 22


async def test_duplicate_taken_is_idempotent(client, db, setup):
    los = setup["meds"]["losartan"]
    body = ev("taken", setup["scheds"]["losartan"].id, 1, "2026-10-30T08:04:10")
    r1 = await post(client, body)
    r2 = await post(client, body)
    assert r1.json() == {"ok": True}
    assert r2.status_code == 200 and r2.json() == {"ok": True, "duplicate": True}
    assert await qty(db, los.id) == 23
    n = await db.scalar(select(func.count()).select_from(DeviceEvent))
    assert n == 1


async def test_second_taken_with_other_time_does_not_double_decrement(client, db, setup):
    los = setup["meds"]["losartan"]
    sid = setup["scheds"]["losartan"].id
    await post(client, ev("taken", sid, 1, "2026-10-30T08:04:10"))
    await post(client, ev("taken", sid, 1, "2026-10-30T08:05:00"))
    assert await qty(db, los.id) == 23


async def test_qty_never_below_zero(client, db, setup):
    los = setup["meds"]["losartan"]
    los.qty = 0
    await db.commit()
    r = await post(client, ev("taken", setup["scheds"]["losartan"].id, 1))
    assert r.status_code == 200
    assert await qty(db, los.id) == 0


async def test_missed_records_and_alerts_caregivers(client, db, setup, redis):
    sid = setup["scheds"]["losartan"].id
    await post(client, ev("due", sid, 1, "2026-10-30T08:00:00"))
    await post(client, ev("missed", sid, 1, "2026-10-30T08:30:00"))
    rec = await intake(db, sid)
    assert rec.status == "missed"
    missed = await alerts(db, "missed")
    assert len(missed) == 1
    assert missed[0].user_id == setup["user"].id
    assert "missed" in missed[0].body and "8:00 AM" in missed[0].body
    assert int(await redis.rpop(PUSH_QUEUE)) == missed[0].id


async def test_duplicate_missed_one_alert(client, db, setup):
    body = ev("missed", setup["scheds"]["losartan"].id, 1, "2026-10-30T08:30:00")
    await post(client, body)
    await post(client, body)
    assert len(await alerts(db, "missed")) == 1


async def test_taken_after_missed_upgrades(client, db, setup):
    sid = setup["scheds"]["losartan"].id
    await post(client, ev("missed", sid, 1, "2026-10-30T08:30:00"))
    await post(client, ev("taken", sid, 1, "2026-10-30T08:31:00"))
    rec = await intake(db, sid)
    assert rec.status == "taken" and rec.delay_minutes == 31


async def test_missed_after_midnight_belongs_to_previous_day(client, db, setup):
    sid = setup["scheds"]["met_pm"].id
    setup["scheds"]["met_pm"].time = __import__("datetime").time(23, 50)
    await db.commit()
    await post(client, ev("missed", sid, 2, "2026-10-31T00:20:00"))
    rec = await intake(db, sid)
    assert rec.dose_date.isoformat() == "2026-10-30"


async def test_expired_event_alerts(client, db, setup):
    sid = setup["scheds"]["amlodipine"].id
    await post(client, ev("expired", sid, 3, "2026-10-30T13:00:00"))
    rec = await intake(db, sid)
    assert rec.status == "expired"
    assert len(await alerts(db, "expired_dose")) == 1


async def test_opened_closed_update_slot_state(client, db, setup):
    await post(client, ev("opened", 0, 4, "2026-10-30T10:00:00"))
    state = await db.scalar(
        select(Device.slot_state).where(Device.device_id == "pillbox").execution_options(populate_existing=True)
    )
    assert state["4"]["lidOpen"] is True
    await post(client, ev("closed", 0, 4, "2026-10-30T10:00:30"))
    state = await db.scalar(select(Device.slot_state).where(Device.device_id == "pillbox"))
    assert state["4"]["lidOpen"] is False


@pytest.mark.parametrize("dose_id", [0, None])
async def test_dose_id_zero_or_missing(client, db, setup, dose_id):
    r = await post(client, ev("scan_ok", dose_id))
    assert r.status_code == 200
    row = await db.scalar(select(DeviceEvent).where(DeviceEvent.type == "scan_ok"))
    assert row.dose_id == 0


async def test_dose_id_missing_duplicate_detected(client, setup):
    body = ev("scan_unknown", None)
    await post(client, body)
    r = await post(client, {**body, "doseId": 0})
    assert r.json()["duplicate"] is True


async def test_unknown_dose_id_still_2xx(client, db, setup):
    r = await post(client, ev("taken", 999999, 1))
    assert r.status_code == 200
    assert await db.scalar(select(func.count()).select_from(IntakeRecord)) == 0


async def test_other_patients_dose_ignored(client, db, setup):
    from tests.factories import make_medicine, make_patient, make_schedule, make_user, pair_device

    u = await make_user(db)
    p = await make_patient(db, u)
    await pair_device(db, p, "pillbox7")
    m = await make_medicine(db, p, qty=10)
    s = await make_schedule(db, m)
    await db.commit()
    await post(client, ev("taken", s.id, 1))
    assert await qty(db, m.id) == 10


async def test_unknown_future_type_stored(client, db, setup):
    r = await post(client, ev("battery_low", 0))
    assert r.status_code == 200


async def test_bad_time_422(client, setup):
    r = await post(client, {"device": "pillbox", "type": "taken", "doseId": 1, "time": "yesterday"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"


async def test_time_with_offset_keeps_wall_clock(client, db, setup):
    sid = setup["scheds"]["losartan"].id
    await post(client, ev("due", sid, 1, "2026-10-30T08:00:00+08:00"))
    row = await db.scalar(select(DeviceEvent).where(DeviceEvent.type == "due"))
    assert row.local_time.isoformat() == "2026-10-30T08:00:00"


async def test_unknown_device_403(client, setup):
    r = await post(client, ev("taken", 1, 1, device="intruder"))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "device_not_registered"


async def test_heartbeat_on_event(client, db, setup):
    await post(client, ev("closed", 0, 1))
    assert await db.scalar(select(Device.last_seen).where(Device.device_id == "pillbox")) is not None


async def test_offline_buffer_resend_of_8_events(client, db, setup):
    sid = setup["scheds"]["losartan"].id
    batch = [ev("opened", 0, 1, f"2026-10-30T09:0{i}:00") for i in range(7)] + [ev("taken", sid, 1)]
    for body in batch:
        await post(client, body)
    for body in batch:
        r = await post(client, body)
        assert r.json().get("duplicate") is True
    assert await qty(db, setup["meds"]["losartan"].id) == 23


async def test_rate_limited(client, setup):
    codes = []
    for i in range(121):
        r = await post(client, ev("opened", 0, 1, f"2026-10-30T09:{i // 60:02d}:{i % 60:02d}"))
        codes.append(r.status_code)
    assert codes[0] == 200 and codes[-1] == 429


async def test_realtime_published_on_taken(client, setup, redis):
    pubsub = redis.pubsub()
    await pubsub.subscribe(f"patient:{setup['patient'].id}")
    await pubsub.get_message(timeout=1)
    await post(client, ev("taken", setup["scheds"]["losartan"].id, 1))
    types = []
    for _ in range(5):
        msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1)
        if msg:
            types.append(json.loads(msg["data"])["type"])
    await pubsub.aclose()
    assert "intake.updated" in types
