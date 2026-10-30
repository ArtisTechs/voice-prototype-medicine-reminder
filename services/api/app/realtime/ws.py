"""WebSocket fan-out: Redis pub/sub channels -> one socket per app session.

Messages are refetch hints ({type, patientId, data, ts}); the app invalidates its queries."""

import asyncio
import contextlib
import json
from collections.abc import Awaitable, Callable

from app.core.logging import get_logger
from app.core.redis import get_redis
from app.realtime.publisher import patient_channel, user_channel

log = get_logger(__name__)
PING_SECONDS = 25.0


class Socket:
    """The bits of starlette's WebSocket the hub needs (lets tests use a fake)."""

    async def send_text(self, data: str) -> None: ...
    async def receive_text(self) -> str: ...


async def serve(
    ws: Socket,
    user_id: int,
    load_patient_ids: Callable[[], Awaitable[list[int]]],
    ping_seconds: float = PING_SECONDS,
) -> None:
    pubsub = get_redis().pubsub()
    subscribed: set[str] = set()

    async def sync_channels() -> None:
        wanted = {user_channel(user_id), *(patient_channel(i) for i in await load_patient_ids())}
        if gone := subscribed - wanted:
            await pubsub.unsubscribe(*gone)
        if new := wanted - subscribed:
            await pubsub.subscribe(*new)
        subscribed.clear()
        subscribed.update(wanted)

    async def forward() -> None:
        while True:
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if msg is None:
                continue
            data = msg["data"]
            with contextlib.suppress(ValueError, KeyError):
                if json.loads(data).get("type") == "patients.changed":
                    await sync_channels()
            await ws.send_text(data)

    async def ping() -> None:
        while True:
            await asyncio.sleep(ping_seconds)
            await ws.send_text(json.dumps({"type": "ping"}))

    async def drain() -> None:
        # Client messages are ignored; this only notices the disconnect.
        while True:
            await ws.receive_text()

    await sync_channels()
    tasks = [asyncio.create_task(c()) for c in (forward, ping, drain)]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            if (exc := t.exception()) and not isinstance(exc, asyncio.CancelledError):
                log.info("ws_closed", reason=type(exc).__name__)
    finally:
        for t in tasks:
            t.cancel()
        with contextlib.suppress(Exception):
            await pubsub.unsubscribe()
            await pubsub.aclose()
