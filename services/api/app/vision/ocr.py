"""Stage 2: label text with RapidOCR (onnxruntime, CPU) + fuzzy match against name and strength."""

import re
from dataclasses import dataclass

import numpy as np
from PIL import Image
from rapidfuzz import fuzz

_engine = None

MONTHS = {m: i for i, m in enumerate(
    ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], start=1)}
_EXP = re.compile(r"EXP(?:IRY)?(?:\.|\s)*(?:DATE)?\s*[:.]?\s*(?P<rest>[0-9A-Z/\-. ]{4,14})", re.IGNORECASE)


def load() -> None:
    global _engine
    from rapidocr_onnxruntime import RapidOCR

    _engine = RapidOCR()


def is_loaded() -> bool:
    return _engine is not None


def read_text(img: Image.Image) -> list[str]:
    if _engine is None:
        return []
    small = img.copy()
    small.thumbnail((1024, 1024))
    result, _elapsed = _engine(np.asarray(small)[:, :, ::-1])  # RapidOCR expects BGR
    return [r[1] for r in result or [] if r and len(r) > 1]


def parse_expiry(lines: list[str]) -> str | None:
    """EXP date on the label, as YYYY-MM or YYYY-MM-DD. Information only (inventory expiry wins)."""
    for line in lines:
        m = _EXP.search(line)
        if not m:
            continue
        rest = m.group("rest").upper().strip()
        if d := re.match(r"(\d{1,2})[/\-. ](\d{4}|\d{2})\b", rest):  # MM/YYYY or MM/YY
            month, year = int(d.group(1)), int(d.group(2))
        elif d := re.match(r"(\d{4})[/\-. ](\d{1,2})(?:[/\-. ](\d{1,2}))?", rest):  # YYYY-MM(-DD)
            year, month = int(d.group(1)), int(d.group(2))
            if d.group(3) and 1 <= month <= 12:
                return f"{year:04d}-{month:02d}-{int(d.group(3)):02d}"
        elif d := re.match(r"(?:(\d{1,2})\s*)?([A-Z]{3})[A-Z]*[\s\-.,]*(\d{4}|\d{2})", rest):  # 30 JUN 2027
            month, year = MONTHS.get(d.group(2), 0), int(d.group(3))
            if d.group(1) and month:
                year = year + 2000 if year < 100 else year
                return f"{year:04d}-{month:02d}-{int(d.group(1)):02d}"
        else:
            continue
        year = year + 2000 if year < 100 else year
        if 1 <= month <= 12 and 2000 <= year <= 2100:
            return f"{year:04d}-{month:02d}"
    return None


@dataclass
class TextScore:
    medicine_id: int
    score: float


def score_candidates(lines: list[str], candidates: list[tuple[int, str, str | None]]) -> list[TextScore]:
    """candidates: (id, name, strength). Name counts 75%, strength 25% (name only when no strength)."""
    text = " ".join(lines).lower()
    if not text.strip():
        return []
    out = []
    for mid, name, strength in candidates:
        name_score = fuzz.partial_ratio(name.lower(), text)
        if strength:
            s = strength.lower().replace(" ", "")
            strength_score = fuzz.partial_ratio(s, text.replace(" ", ""))
            score = 0.75 * name_score + 0.25 * strength_score
        else:
            score = name_score
        out.append(TextScore(mid, score))
    return sorted(out, key=lambda s: s.score, reverse=True)


def pick(scores: list[TextScore], threshold: float, margin: float) -> TextScore | None:
    if not scores or scores[0].score < threshold:
        return None
    if len(scores) > 1 and scores[0].score - scores[1].score < margin:
        return None
    return scores[0]
