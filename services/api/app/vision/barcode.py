"""Stage 1: barcode via zxing-cpp on the image and a few rotations/crops."""

import re
from collections.abc import Iterator

import zxingcpp
from PIL import Image

_DIGITS = re.compile(r"\D")


def normalize(code: str) -> str:
    """Compare barcodes by digits without leading zeros (UPC-A vs EAN-13); non-numeric as-is."""
    code = code.strip()
    digits = _DIGITS.sub("", code)
    if digits and len(digits) >= 6 and len(digits) == len(code.replace(" ", "").replace("-", "")):
        return digits.lstrip("0")
    return code.upper()


def _variants(img: Image.Image) -> Iterator[Image.Image]:
    yield img
    for angle in (90, 180, 270):
        yield img.rotate(angle, expand=True)
    w, h = img.size
    yield img.crop((w // 4, h // 4, w * 3 // 4, h * 3 // 4))
    yield img.crop((0, 0, w // 2, h))
    yield img.crop((w // 2, 0, w, h))
    yield img.crop((0, h // 2, w, h))
    center = img.crop((w // 3, h // 3, w * 2 // 3, h * 2 // 3))
    yield center.resize((center.width * 2, center.height * 2), Image.Resampling.BICUBIC)


def read_codes(img: Image.Image, should_stop=lambda: False) -> list[str]:
    gray = img.convert("L")
    for variant in _variants(gray):
        if should_stop():
            break
        results = zxingcpp.read_barcodes(variant)
        codes = [r.text for r in results if r.valid and r.text]
        if codes:
            return codes
    return []
