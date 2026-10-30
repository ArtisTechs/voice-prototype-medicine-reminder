"""Redis job locks so two workers never run the same job at once."""

import contextlib
import uuid
from collections.abc import AsyncIterator

from app.core.redis import get_redis

_RELEASE = """
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end
"""


@contextlib.asynccontextmanager
async def with_lock(name: str, ttl: int = 120) -> AsyncIterator[bool]:
    """Yields True if this process holds the lock; the caller skips the work when False."""
    r = get_redis()
    token = uuid.uuid4().hex
    key = f"lock:{name}"
    got = bool(await r.set(key, token, nx=True, ex=ttl))
    try:
        yield got
    finally:
        if got:
            await r.eval(_RELEASE, 1, key, token)
