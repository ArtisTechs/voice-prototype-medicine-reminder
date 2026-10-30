"""Shorten text for the ESP32 firmware buffers. See D4: output is ASCII, so bytes == chars."""

import re
import unicodedata

_SPACES = re.compile(r"\s+")
_TRAILING = " ,.;:-/(&+"
_MAP = {"–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "µ": "u"}


def to_ascii(value: str) -> str:
    value = "".join(_MAP.get(ch, ch) for ch in value)
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = "".join(ch for ch in value if ch.isprintable())
    return _SPACES.sub(" ", value).strip()


def fit(value: str | None, limit: int) -> str:
    """ASCII, at most `limit` chars, cut at a word boundary when that keeps >=60% of the limit."""
    text = to_ascii(value or "")
    if len(text) <= limit:
        return text
    cut = text[: limit + 1]
    space = cut.rfind(" ")
    if space >= int(limit * 0.6):
        cut = cut[:space]
    else:
        cut = text[:limit]
    return cut.rstrip(_TRAILING)[:limit]
