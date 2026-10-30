"""Scan pipeline: barcode -> OCR -> embedding -> optional Claude. Stops at the first confident match.
Every stage runs in a thread pool under the overall deadline (see medicine-vision skill)."""

import asyncio
import io
import time
from collections.abc import Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from PIL import Image

from app.core.config import get_settings
from app.core.logging import get_logger
from app.vision import barcode

log = get_logger(__name__)

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="vision")
_slots = asyncio.Semaphore(2)

# Minimum seconds left to start each stage.
STAGE_MIN = {"barcode": 0.2, "ocr": 1.5, "embed": 0.6, "llm": 4.0}


@dataclass
class Candidate:
    id: int
    label: str
    barcode: str | None = None


@dataclass
class Match:
    medicine_id: int | None = None
    method: str = "none"
    score: float | None = None
    ocr_expiry: str | None = None
    timings: dict[str, int] = field(default_factory=dict)

    @property
    def found(self) -> bool:
        return self.medicine_id is not None


class Deadline:
    def __init__(self, seconds: float):
        self.end = time.monotonic() + seconds

    def remaining(self) -> float:
        return self.end - time.monotonic()

    def expired(self) -> bool:
        return self.remaining() <= 0


EmbedLookup = Callable[[list[float]], Awaitable[list[tuple[int, float]]]]


async def _run(fn, *args):
    return await asyncio.get_running_loop().run_in_executor(_executor, fn, *args)


def decode(image: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(image))
    img.load()
    return img.convert("RGB")


def match_barcode(codes: list[str], candidates: list[Candidate]) -> int | None:
    wanted = {barcode.normalize(c.barcode): c.id for c in candidates if c.barcode}
    for code in codes:
        mid = wanted.get(barcode.normalize(code))
        if mid:
            return mid
    return None


async def identify(
    image: bytes,
    candidates: list[Candidate],
    embed_lookup: EmbedLookup | None = None,
    budget: float | None = None,
) -> Match:
    s = get_settings()
    deadline = Deadline(budget if budget is not None else s.scan_budget_seconds)
    result = Match()
    t0 = time.monotonic()
    try:
        await asyncio.wait_for(_slots.acquire(), timeout=1.0)
    except TimeoutError:
        result.timings["queue"] = int((time.monotonic() - t0) * 1000)
        log.warning("scan_busy")
        return result
    try:
        img = await _run(decode, image)
        if not candidates:
            return result
        for name, stage in _stages():
            if deadline.remaining() < STAGE_MIN[name]:
                result.timings[name] = -1
                continue
            started = time.monotonic()
            try:
                await asyncio.wait_for(
                    stage(img, image, candidates, result, deadline, embed_lookup), timeout=deadline.remaining()
                )
            except TimeoutError:
                log.warning("scan_stage_timeout", stage=name)
            except Exception:
                log.exception("scan_stage_failed", stage=name)
            result.timings[name] = int((time.monotonic() - started) * 1000)
            if result.found:
                break
    finally:
        _slots.release()
        result.timings["total"] = int((time.monotonic() - t0) * 1000)
    return result


async def _stage_barcode(img, _raw, candidates, result: Match, deadline: Deadline, _lookup) -> None:
    codes = await _run(barcode.read_codes, img, deadline.expired)
    mid = match_barcode(codes, candidates)
    if mid:
        result.medicine_id, result.method, result.score = mid, "barcode", 1.0


def _stages():
    from app.vision import stages

    yield "barcode", _stage_barcode
    yield from stages.extra_stages()
