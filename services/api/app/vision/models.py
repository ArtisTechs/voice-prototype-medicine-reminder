"""Load vision models once at API startup and warm them up."""

import time

from fastapi.concurrency import run_in_threadpool
from PIL import Image

from app.core.logging import get_logger
from app.vision import barcode

log = get_logger(__name__)


def _warm_barcode() -> None:
    barcode.read_codes(Image.new("RGB", (1024, 768), "white"))


async def load_models() -> None:
    t0 = time.monotonic()
    await run_in_threadpool(_warm_barcode)
    log.info("vision_warm", stage="barcode", ms=int((time.monotonic() - t0) * 1000))
