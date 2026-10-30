import json
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.timeutil import utcnow
from app.jobs import push
from app.jobs.locks import with_lock
from app.models import Alert, IntakeRecord, PushToken, Scan
from app.services import alert_service, monitor_service
from app.services.alert_service import PUSH_QUEUE
from tests.conftest import auth_headers
from tests.factories import make_medicine, make_patient, make_schedule, make_user, pair_device

OLD = datetime(2026, 1, 1, tzinfo=UTC)


@pytest.fixture
async def ctx(db):
    user = await make_user(db)
    patient = await make_patient(db, user, display_name="Lola Rosa")
    dev = await pair_device(db, patient)
    los = await make_medicine(db, patient)
    s8 = await make_schedule(db, los, time(8, 0))
    s8.created_at = OLD
    await db.commit()
    return {"user": user, "patient": patient, "dev": dev, "los": los, "s8": s8}


def ph(hh, mm=0, day=30):
    return datetime(2026, 10, day, hh, mm, tzinfo=UTC) - timedelta(hours=8)


async def count(db, type_):
    return await db.scalar(select(func.count()).select_from(Alert).where(Alert.type == type_))


# ---- inbox API -------------------------------------------------------------------------------


async def test_alert_inbox_read_and_isolation(client, db, ctx):
    other = await make_user(db)
    for i in range(3):
        db.add(Alert(user_id=ctx["user"].id, patient_id=ctx["patient"].id, type="missed", title=f"t{i}", body="b",
                     dedup_key=f"k{i}", data={}))
    foreign = Alert(user_id=other.id, type="missed", title="x", body="y", dedup_key="z", data={})
    db.add(foreign)
    await db.commit()
    h = auth_headers(ctx["user"])
    page = (await client.get("/api/v1/alerts", params={"limit": 2}, headers=h)).json()
    assert page["total"] == 3 and len(page["items"]) == 2 and page["items"][0]["title"] == "t2"
    first = page["items"][0]["id"]
    assert (await client.post(f"/api/v1/alerts/{first}/read", headers=h)).status_code == 204
    unread = (await client.get("/api/v1/alerts", params={"unread": True}, headers=h)).json()
    assert unread["total"] == 2
    assert (await client.post(f"/api/v1/alerts/{foreign.id}/read", headers=h)).status_code == 404
    assert (await client.post("/api/v1/alerts/read-all", headers=h)).status_code == 204
    assert (await client.get("/api/v1/alerts", params={"unread": True}, headers=h)).json()["total"] == 0


# ---- rules ---------------------------------------------------------------------------------


async def test_missed_fallback_once_and_only_after_window(db, ctx, frozen):
    frozen.move_to(ph(8, 30))
    assert not await monitor_service.reconcile_missed(db)
    frozen.move_to(ph(8, 36))
    created = await monitor_service.reconcile_missed(db)
    assert len(created.items) == 1
    rec = await db.scalar(select(IntakeRecord).where(IntakeRecord.schedule_id == ctx["s8"].id))
    assert rec.status == "missed" and rec.source == "fallback"
    assert not await monitor_service.reconcile_missed(db)
    assert await count(db, "missed") == 1


async def test_missed_fallback_skips_new_schedule(db, ctx, frozen):
    ctx["s8"].created_at = ph(9)  # created after today's 08:00 dose
    await db.commit()
    frozen.move_to(ph(9, 30))
    assert not await monitor_service.reconcile_missed(db)


async def test_device_missed_and_fallback_share_one_alert(client, db, ctx, frozen):
    frozen.move_to(ph(8, 31))
    await client.post("/api/events", json={"device": "pillbox", "type": "missed", "doseId": ctx["s8"].id,
                                           "time": "2026-10-30T08:30:00"})
    frozen.move_to(ph(8, 40))
    await monitor_service.reconcile_missed(db)
    assert await count(db, "missed") == 1


async def test_offline_once_per_outage(db, ctx, frozen):
    ctx["dev"].last_seen = utcnow() - timedelta(minutes=11)
    await db.commit()
    assert len((await monitor_service.offline_devices(db)).items) == 1
    assert not await monitor_service.offline_devices(db)
    alert = await db.scalar(select(Alert).where(Alert.type == "offline"))
    assert "Lola Rosa" in alert.body and alert.severity == "high"
    # Back online, then offline again: a new outage, a new alert.
    ctx["dev"].last_seen = utcnow() - timedelta(minutes=12, seconds=30)
    await db.commit()
    assert len((await monitor_service.offline_devices(db)).items) == 1


async def test_not_offline_within_10_min(db, ctx):
    ctx["dev"].last_seen = utcnow() - timedelta(minutes=9)
    await db.commit()
    assert not await monitor_service.offline_devices(db)


async def test_refill_rule_days_left(db, ctx):
    los = ctx["los"]
    los.qty, los.low_stock_threshold, los.refill_lead_days = 10, 2, 3
    await db.commit()
    assert not await monitor_service.inventory(db)  # 10 days left, threshold 2
    los.qty = 3  # 3 days left == lead time
    await db.commit()
    assert len((await monitor_service.inventory(db)).items) == 1
    assert not await monitor_service.inventory(db)  # once a day
    alert = await db.scalar(select(Alert).where(Alert.type == "low_stock"))
    assert "3 left" in alert.body


@pytest.mark.parametrize(
    ("expiry", "bucket"),
    [(date(2026, 11, 25), 30), (date(2026, 11, 5), 7), (date(2026, 10, 30), 0), (date(2026, 9, 1), 0), (date(2027, 1, 1), None)],
)
async def test_expiry_buckets(db, ctx, expiry, bucket):
    ctx["los"].expiry_date = expiry
    await db.commit()
    created = await monitor_service.expiry(db, date(2026, 10, 30))
    if bucket is None:
        assert not created
        return
    alert = await db.scalar(select(Alert).where(Alert.type == "expiry"))
    assert alert.dedup_key.endswith(f":{bucket}")
    assert not await monitor_service.expiry(db, date(2026, 10, 30))


async def test_expiry_walks_through_buckets(db, ctx):
    ctx["los"].expiry_date = date(2026, 12, 1)
    await db.commit()
    for day in (date(2026, 11, 1), date(2026, 11, 2), date(2026, 11, 24), date(2026, 12, 1), date(2026, 12, 5)):
        await monitor_service.expiry(db, day)
    assert await count(db, "expiry") == 3


async def test_prefs_taken_off_by_default_and_hide_names(client, db, ctx):
    sid = ctx["s8"].id
    await client.post("/api/events", json={"device": "pillbox", "type": "taken", "doseId": sid, "time": "2026-10-30T08:02:00"})
    assert await count(db, "taken") == 0
    ctx["user"].notify_prefs = {"taken": True, "hide_medicine_names": True}
    await db.commit()
    await client.post("/api/events", json={"device": "pillbox", "type": "missed", "doseId": sid, "time": "2026-10-31T08:30:00"})
    missed = await db.scalar(select(Alert).where(Alert.type == "missed"))
    assert "a medicine" in missed.body and "Losartan" not in missed.body


async def test_all_caregivers_get_missed(client, db, ctx):
    from app.models import PatientCaregiver

    helper = await make_user(db)
    db.add(PatientCaregiver(patient_id=ctx["patient"].id, user_id=helper.id, role="member"))
    await db.commit()
    await client.post("/api/events", json={"device": "pillbox", "type": "missed", "doseId": ctx["s8"].id,
                                           "time": "2026-10-30T08:30:00"})
    users = set((await db.scalars(select(Alert.user_id).where(Alert.type == "missed"))).all())
    assert users == {ctx["user"].id, helper.id}


async def test_cleanup_retention(db, ctx):
    path = Path(get_settings().scan_dir) / "scans/old/x.jpg"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\xff\xd8\xff")
    db.add(Scan(patient_id=ctx["patient"].id, device_id="pillbox-cam", image_path="scans/old/x.jpg", found=False,
                method="none", duration_ms=1, result={}, timings={}, created_at=utcnow() - timedelta(days=31)))
    db.add(Scan(patient_id=ctx["patient"].id, device_id="pillbox-cam", image_path="scans/new/y.jpg", found=False,
                method="none", duration_ms=1, result={}, timings={}, created_at=utcnow() - timedelta(days=29)))
    await db.commit()
    counts = await monitor_service.cleanup(db)
    assert counts["scans"] == 1 and not path.exists()
    assert await db.scalar(select(func.count()).select_from(Scan)) == 1


# ---- push ----------------------------------------------------------------------------------


async def test_push_delivery_and_dead_tokens(db, ctx, monkeypatch):
    db.add_all([
        PushToken(user_id=ctx["user"].id, token="ExponentPushToken[good]", platform="android"),
        PushToken(user_id=ctx["user"].id, token="ExponentPushToken[dead]", platform="android"),
    ])
    a = Alert(user_id=ctx["user"].id, patient_id=ctx["patient"].id, type="missed", title="Missed", body="b",
              dedup_key="m1", data={"url": "/patients/1"})
    db.add(a)
    await db.commit()
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        msgs = json.loads(request.content)
        seen.extend(msgs)
        return httpx.Response(200, json={"data": [
            {"status": "ok", "id": "1"} if m["to"].endswith("[good]") else
            {"status": "error", "details": {"error": "DeviceNotRegistered"}} for m in msgs]})

    monkeypatch.setattr(get_settings(), "expo_push_enabled", True)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await push.deliver([a.id], client) == 1
    assert {m["to"] for m in seen} == {"ExponentPushToken[good]", "ExponentPushToken[dead]"}
    assert seen[0]["channelId"] == "alerts" and seen[0]["data"]["url"] == "/patients/1"
    tokens = set((await db.scalars(select(PushToken.token))).all())
    assert tokens == {"ExponentPushToken[good]"}
    assert (await db.scalar(select(Alert.pushed_at).where(Alert.id == a.id).execution_options(populate_existing=True)))
    # Already pushed: never sent twice.
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await push.deliver([a.id], client) == 0


async def test_missed_event_queues_push(client, db, ctx, redis):
    await client.post("/api/events", json={"device": "pillbox", "type": "missed", "doseId": ctx["s8"].id,
                                           "time": "2026-10-30T08:30:00"})
    alert_id = await db.scalar(select(Alert.id).where(Alert.type == "missed"))
    assert int(await redis.rpop(PUSH_QUEUE)) == alert_id


async def test_lock_is_exclusive():
    async with with_lock("t", 5) as a:
        async with with_lock("t", 5) as b:
            assert a is True and b is False
    async with with_lock("t", 5) as c:
        assert c is True


async def test_dedup_key_unique_per_user(db, ctx):
    p = ctx["patient"]
    first = await alert_service.raise_alert(db, p, "offline", "k", "t", "b")
    second = await alert_service.raise_alert(db, p, "offline", "k", "t", "b")
    assert len(first.items) == 1 and not second
