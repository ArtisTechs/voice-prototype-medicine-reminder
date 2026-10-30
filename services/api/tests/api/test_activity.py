import asyncio
import json
from datetime import UTC, date, datetime, time, timedelta

import pytest

from app.core.timeutil import dose_instant
from app.models import Alert, IntakeRecord
from app.realtime import ws as hub
from app.realtime.publisher import publish, publish_user
from tests.conftest import auth_headers
from tests.factories import make_medicine, make_patient, make_schedule, make_user, pair_device


@pytest.fixture
async def ctx(db):
    user = await make_user(db)
    patient = await make_patient(db, user)
    await pair_device(db, patient)
    los = await make_medicine(db, patient)
    amlo = await make_medicine(db, patient, name="Amlodipine", strength="5mg", slot=3, expiry_date=date(2026, 9, 30))
    s8 = await make_schedule(db, los, time(8, 0))
    s13 = await make_schedule(db, amlo, time(13, 0))
    s20 = await make_schedule(db, los, time(20, 0))
    await db.commit()
    return {"user": user, "patient": patient, "h": auth_headers(user), "los": los, "s8": s8, "s13": s13, "s20": s20}


def ph(hh, mm=0, day=30):
    return datetime(2026, 10, day, hh, mm, tzinfo=UTC) - timedelta(hours=8)


async def ev(client, type_, sid, t):
    return await client.post("/api/events", json={"device": "pillbox", "type": type_, "doseId": sid, "time": t})


async def get_today(client, ctx):
    # Fresh token: tests move the clock past the 15 min access-token lifetime.
    url = f"/api/v1/patients/{ctx['patient'].id}/today"
    return (await client.get(url, headers=auth_headers(ctx["user"]))).json()


async def test_today_upcoming_and_expired(client, ctx):
    body = await get_today(client, ctx)
    assert body["date"] == "2026-10-30"
    statuses = {d["scheduleId"]: d["status"] for d in body["doses"]}
    assert statuses == {ctx["s8"].id: "upcoming", ctx["s13"].id: "expired", ctx["s20"].id: "upcoming"}
    assert body["summary"]["total"] == 3


async def test_today_due_taken_late_missed(client, ctx, frozen):
    frozen.move_to(ph(8, 5))
    assert {d["scheduleId"]: d["status"] for d in (await get_today(client, ctx))["doses"]}[ctx["s8"].id] == "due"
    await ev(client, "taken", ctx["s8"].id, "2026-10-30T08:04:00")
    d8 = next(d for d in (await get_today(client, ctx))["doses"] if d["scheduleId"] == ctx["s8"].id)
    assert d8["status"] == "taken" and d8["delayMinutes"] == 4 and d8["takenAt"]
    frozen.move_to(ph(20, 40))
    body = await get_today(client, ctx)
    d20 = next(d for d in body["doses"] if d["scheduleId"] == ctx["s20"].id)
    assert d20["status"] == "missed"  # no event yet, but past the 35 min window
    await ev(client, "taken", ctx["s20"].id, "2026-10-30T20:25:00")
    d20 = next(d for d in (await get_today(client, ctx))["doses"] if d["scheduleId"] == ctx["s20"].id)
    assert d20["status"] == "late" and d20["delayMinutes"] == 25


async def test_history_adherence(client, db, ctx):
    p, los = ctx["patient"], ctx["los"]
    rows = [
        (date(2026, 10, 27), "taken", 0),
        (date(2026, 10, 28), "taken", 40),
        (date(2026, 10, 29), "missed", None),
    ]
    for day, status, delay in rows:
        db.add(IntakeRecord(patient_id=p.id, medicine_id=los.id, schedule_id=ctx["s8"].id, dose_date=day,
                            scheduled_time=time(8, 0), status=status, delay_minutes=delay,
                            due_at=dose_instant(day, time(8, 0))))
    await db.commit()
    r = await client.get(f"/api/v1/patients/{p.id}/history", params={"from": "2026-10-24", "to": "2026-10-30"},
                         headers=ctx["h"])
    assert r.status_code == 200
    body = r.json()
    assert body["overall"] == {"taken": 1, "late": 1, "missed": 1, "expired": 0, "adherence": 66.7}
    assert len(body["days"]) == 7
    assert body["days"][0]["adherence"] is None  # no data shows as "-", not 0%
    assert body["medicines"][0]["medicineName"] == "Losartan 50mg"
    assert [rec["status"] for rec in body["records"]] == ["missed", "late", "taken"]


async def test_history_range_rules(client, ctx):
    url = f"/api/v1/patients/{ctx['patient'].id}/history"
    assert (await client.get(url, params={"from": "2026-01-01", "to": "2026-10-30"}, headers=ctx["h"])).status_code == 400
    assert (await client.get(url, params={"from": "2026-10-30", "to": "2026-10-01"}, headers=ctx["h"])).status_code == 400
    default = (await client.get(url, headers=ctx["h"])).json()
    assert default["fromDate"] == "2026-10-24" and default["toDate"] == "2026-10-30"


async def test_dashboard(client, db, ctx):
    ctx["los"].qty = 2
    db.add(Alert(user_id=ctx["user"].id, patient_id=ctx["patient"].id, type="missed", title="t", body="b",
                 dedup_key="k1", data={}))
    await db.commit()
    body = (await client.get("/api/v1/dashboard", headers=ctx["h"])).json()
    card = body["patients"][0]
    assert body["unreadAlerts"] == 1 and card["unreadAlerts"] == 1
    assert card["today"]["total"] == 3
    assert card["nextDose"]["time"] == "08:00"
    assert [m["name"] for m in card["lowStock"]] == ["Losartan 50mg"]
    assert card["expiringSoon"][0]["name"] == "Amlodipine 5mg" and card["expiringSoon"][0]["daysToExpiry"] == -30
    assert card["device"]["status"] == "offline"


class FakeSocket:
    def __init__(self):
        self.sent: list[dict] = []
        self.closed = asyncio.Event()

    async def send_text(self, data: str) -> None:
        self.sent.append(json.loads(data))

    async def receive_text(self) -> str:
        await self.closed.wait()
        raise RuntimeError("disconnected")


async def _wait_for(pred, timeout=3.0):
    end = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < end:
        if pred():
            return True
        await asyncio.sleep(0.05)
    return False


async def test_ws_hub_forwards_only_own_patients_and_resubscribes():
    sock = FakeSocket()
    ids = [1]

    async def load():
        return list(ids)

    task = asyncio.create_task(hub.serve(sock, 77, load, ping_seconds=0.2))
    await asyncio.sleep(0.2)
    await publish(1, "intake.updated")
    await publish(2, "intake.updated")
    assert await _wait_for(lambda: any(m.get("patientId") == 1 for m in sock.sent))
    ids.append(2)
    await publish_user(77, "patients.changed")
    await asyncio.sleep(0.3)
    await publish(2, "alert.created")
    assert await _wait_for(lambda: any(m.get("patientId") == 2 and m["type"] == "alert.created" for m in sock.sent))
    assert not any(m.get("patientId") == 2 and m["type"] == "intake.updated" for m in sock.sent)
    assert await _wait_for(lambda: any(m["type"] == "ping" for m in sock.sent))
    sock.closed.set()
    await asyncio.wait_for(task, 3)


async def test_event_reaches_ws_within_2s(client, ctx):
    sock = FakeSocket()
    pid = ctx["patient"].id

    async def load():
        return [pid]

    task = asyncio.create_task(hub.serve(sock, ctx["user"].id, load))
    await asyncio.sleep(0.2)
    await ev(client, "missed", ctx["s8"].id, "2026-10-30T08:30:00")
    assert await _wait_for(lambda: {"intake.updated", "alert.created"} <= {m["type"] for m in sock.sent}, 2.0)
    sock.closed.set()
    await asyncio.wait_for(task, 3)
