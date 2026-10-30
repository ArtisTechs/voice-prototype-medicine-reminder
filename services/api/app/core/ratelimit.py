"""Fixed-window rate limits in Redis. Fails open: a Redis outage must not stop the pillbox."""

import time

from app.core.config import get_settings
from app.core.errors import RateLimited
from app.core.logging import get_logger
from app.core.redis import get_redis

log = get_logger(__name__)


async def check_rate(scope: str, ident: str, limit: int, window_s: int = 60) -> None:
    if not get_settings().rate_limit_enabled:
        return
    bucket = int(time.time() // window_s)
    key = f"rl:{scope}:{ident}:{bucket}"
    try:
        r = get_redis()
        count = await r.incr(key)
        if count == 1:
            await r.expire(key, window_s + 5)
    except Exception:
        log.warning("ratelimit_unavailable", scope=scope)
        return
    if count > limit:
        raise RateLimited(message="Too many requests. Try again in a minute.")
