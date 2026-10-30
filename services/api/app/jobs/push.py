"""Expo push sender: BRPOP alert ids from Redis, send through the Expo push service.

https://docs.expo.dev/push-notifications/sending-notifications/ (batches of <= 100 messages)."""

import asyncio

import httpx
from sqlalchemy import delete, select, update

from app.core.config import get_settings
from app.core.db import session_scope
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.core.timeutil import utcnow
from app.models import Alert, PushToken
from app.services.alert_service import PUSH_QUEUE

log = get_logger(__name__)
BATCH = 100
RETRIES = 3


async def build_messages(alert_ids: list[int]) -> tuple[list[dict], dict[int, list[str]]]:
    """One message per (alert, token). Returns messages and alert_id -> tokens."""
    async with session_scope() as db:
        alerts = (await db.scalars(select(Alert).where(Alert.id.in_(alert_ids), Alert.pushed_at.is_(None)))).all()
        user_ids = {a.user_id for a in alerts}
        tokens = (await db.scalars(select(PushToken).where(PushToken.user_id.in_(user_ids)))).all() if user_ids else []
    by_user: dict[int, list[str]] = {}
    for t in tokens:
        by_user.setdefault(t.user_id, []).append(t.token)
    messages, sent_to = [], {}
    for a in alerts:
        for token in by_user.get(a.user_id, []):
            messages.append(
                {
                    "to": token,
                    "title": a.title,
                    "body": a.body,
                    "sound": "default",
                    "priority": "high",
                    "channelId": "alerts",
                    "data": {"alertId": a.id, "patientId": a.patient_id, "url": (a.data or {}).get("url", "/alerts")},
                }
            )
            sent_to.setdefault(a.id, []).append(token)
    return messages, sent_to


async def send_batch(client: httpx.AsyncClient, messages: list[dict]) -> list[dict]:
    s = get_settings()
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if s.expo_access_token:
        headers["Authorization"] = f"Bearer {s.expo_access_token}"
    for attempt in range(RETRIES):
        try:
            r = await client.post(s.expo_push_url, json=messages, headers=headers, timeout=10)
            if r.status_code < 500:
                r.raise_for_status()
                return r.json().get("data", [])
        except httpx.HTTPError as e:
            log.warning("push_http_error", attempt=attempt, error=type(e).__name__)
        await asyncio.sleep(2**attempt)
    log.error("push_gave_up", count=len(messages))
    return []


async def deliver(alert_ids: list[int], client: httpx.AsyncClient | None = None) -> int:
    """Send push for these alerts. Returns how many messages Expo accepted."""
    messages, _ = await build_messages(alert_ids)
    if not messages:
        await _mark_pushed(alert_ids)
        return 0
    if not get_settings().expo_push_enabled:
        log.info("push_disabled", count=len(messages))
        await _mark_pushed(alert_ids)
        return 0
    ok = 0
    dead: list[str] = []
    own = client is None
    client = client or httpx.AsyncClient()
    try:
        for i in range(0, len(messages), BATCH):
            chunk = messages[i : i + BATCH]
            tickets = await send_batch(client, chunk)
            for msg, ticket in zip(chunk, tickets, strict=False):
                if ticket.get("status") == "ok":
                    ok += 1
                elif (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                    dead.append(msg["to"])
    finally:
        if own:
            await client.aclose()
    async with session_scope() as db:
        if dead:
            await db.execute(delete(PushToken).where(PushToken.token.in_(dead)))
        await db.commit()
    await _mark_pushed(alert_ids)
    log.info("push_sent", ok=ok, removed_tokens=len(dead))
    return ok


async def _mark_pushed(alert_ids: list[int]) -> None:
    async with session_scope() as db:
        await db.execute(update(Alert).where(Alert.id.in_(alert_ids)).values(pushed_at=utcnow()))
        await db.commit()


async def push_consumer(stop: asyncio.Event) -> None:
    r = get_redis()
    async with httpx.AsyncClient() as client:
        while not stop.is_set():
            try:
                item = await r.brpop([PUSH_QUEUE], timeout=2)
                if item is None:
                    continue
                ids = [int(item[1])]
                # Drain what else is waiting so one batch covers a burst.
                while len(ids) < BATCH and (more := await r.rpop(PUSH_QUEUE)):
                    ids.append(int(more))
                await deliver(ids, client)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("push_consumer_error")
                await asyncio.sleep(1)
