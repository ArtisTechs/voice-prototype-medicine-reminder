"""Stages after the barcode: OCR -> package look (CLIP + pgvector) -> optional Claude."""

from app.core.config import get_settings
from app.vision import embed, llm, ocr


async def _stage_ocr(img, _raw, candidates, result, deadline, _lookup) -> None:
    from app.vision.pipeline import _run

    s = get_settings()
    lines = await _run(ocr.read_text, img)
    result.ocr_expiry = ocr.parse_expiry(lines)
    meta = [(c.id, c.name, c.strength) for c in candidates]
    best = ocr.pick(ocr.score_candidates(lines, meta), s.vision_ocr_threshold, s.vision_ocr_margin)
    if best:
        result.medicine_id, result.method, result.score = best.medicine_id, "ocr", round(best.score / 100, 3)


async def _stage_embed(img, _raw, _candidates, result, _deadline, lookup) -> None:
    from app.vision.pipeline import _run

    if lookup is None:
        return
    s = get_settings()
    vec = await _run(embed.embed_image, img)
    if vec is None:
        return
    best = embed.pick(await lookup(vec), s.vision_embed_threshold, s.vision_embed_margin)
    if best:
        result.medicine_id, result.method, result.score = best[0], "embed", round(best[1], 3)


async def _stage_llm(_img, raw, candidates, result, deadline, _lookup) -> None:
    mid = await llm.choose(raw, [(c.id, c.label) for c in candidates], timeout=max(0.5, deadline.remaining() - 0.5))
    if mid:
        result.medicine_id, result.method, result.score = mid, "llm", None


def extra_stages():
    if ocr.is_loaded():
        yield "ocr", _stage_ocr
    if embed.is_loaded():
        yield "embed", _stage_embed
    if llm.enabled():
        yield "llm", _stage_llm
