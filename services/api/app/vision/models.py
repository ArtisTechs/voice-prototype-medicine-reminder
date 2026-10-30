"""Load vision models once at API startup and warm them up (logs load and warm-up ms)."""

import time

from fastapi.concurrency import run_in_threadpool
from PIL import Image

from app.core.logging import get_logger
from app.vision import barcode, embed, ocr

log = get_logger(__name__)


def _timed(stage: str, fn) -> None:
    t0 = time.monotonic()
    try:
        fn()
    except Exception:
        log.exception("vision_load_failed", stage=stage)
        return
    log.info("vision_ready", stage=stage, ms=int((time.monotonic() - t0) * 1000))


def load_all() -> None:
    blank = Image.new("RGB", (1024, 768), "white")
    _timed("barcode_warm", lambda: barcode.read_codes(blank))
    _timed("ocr_load", ocr.load)
    _timed("ocr_warm", lambda: ocr.read_text(blank))
    _timed("embed_load", embed.load)
    _timed("embed_warm", lambda: embed.embed_image(blank))


async def load_models() -> None:
    await run_in_threadpool(load_all)
