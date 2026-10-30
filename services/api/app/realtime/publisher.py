"""Publish realtime hints to Redis. Call only after the DB commit. Messages carry ids, not records."""

import json
from typing import Any

from app.core.logging import get_logger
from app.core.redis import get_redis
from app.core.timeutil import utcnow

log = get_logger(__name__)


def patient_channel(patient_id: int) -> str:
    return f"patient:{patient_id}"


def user_channel(user_id: int) -> str:
    return f"user:{user_id}"


async def _send(channel: str, msg: dict[str, Any]) -> None:
    try:
        await get_redis().publish(channel, json.dumps(msg, default=str))
    except Exception:
        log.warning("publish_failed", channel=channel, type=msg.get("type"))


async def publish(patient_id: int, type_: str, data: dict[str, Any] | None = None) -> None:
    await _send(
        patient_channel(patient_id),
        {"type": type_, "patientId": patient_id, "data": data or {}, "ts": utcnow().isoformat()},
    )


async def publish_user(user_id: int, type_: str, data: dict[str, Any] | None = None) -> None:
    await _send(user_channel(user_id), {"type": type_, "data": data or {}, "ts": utcnow().isoformat()})
