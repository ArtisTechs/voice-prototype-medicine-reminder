"""Worker entrypoint: python -m app.worker  (APScheduler jobs + Expo push consumer)."""

import asyncio
import signal

from app.core.config import get_settings
from app.core.db import dispose_engine
from app.core.logging import get_logger, setup_logging
from app.core.redis import close_redis
from app.jobs.scheduler import build_scheduler, run_startup_jobs
from app.jobs.push import push_consumer

log = get_logger(__name__)


async def main() -> None:
    setup_logging(get_settings().log_level)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    scheduler = build_scheduler()
    scheduler.start()
    log.info("worker_started", jobs=len(scheduler.get_jobs()))
    await run_startup_jobs()
    consumer = asyncio.create_task(push_consumer(stop))
    await stop.wait()
    scheduler.shutdown(wait=False)
    consumer.cancel()
    await close_redis()
    await dispose_engine()
    log.info("worker_stopped")


if __name__ == "__main__":
    asyncio.run(main())
