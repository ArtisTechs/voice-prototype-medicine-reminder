"""Synthetic medicine-package photos for tests, the simulator and the vision eval."""

import io
import random

import numpy as np
import zxingcpp
from PIL import Image, ImageDraw, ImageFont

FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def font(size: int) -> ImageFont.ImageFont:
    for path in FONT_PATHS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def barcode_image(code: str, scale: int = 4) -> Image.Image:
    fmt = zxingcpp.BarcodeFormat.EAN13 if code.isdigit() and len(code) == 13 else zxingcpp.BarcodeFormat.Code128
    bc = zxingcpp.create_barcode(code, fmt)
    arr = np.asarray(bc.to_image(scale=scale, add_quiet_zones=True))
    return Image.fromarray(arr).convert("RGB")


def package(
    name: str,
    strength: str = "",
    code: str | None = None,
    color: tuple[int, int, int] = (40, 110, 180),
    seed: int = 0,
    show_text: bool = True,
    angle: float = 0.0,
    size: tuple[int, int] = (1024, 768),
) -> Image.Image:
    rnd = random.Random(seed)
    w, h = size
    bg = tuple(rnd.randint(150, 220) for _ in range(3))
    img = Image.new("RGB", size, bg)
    box = Image.new("RGB", (int(w * 0.72), int(h * 0.62)), "white")
    d = ImageDraw.Draw(box)
    bw, bh = box.size
    d.rectangle((0, 0, bw, int(bh * 0.28)), fill=color)
    d.rectangle((0, int(bh * 0.9), bw, bh), fill=color)
    if show_text:
        d.text((30, int(bh * 0.33)), name.upper(), fill=(20, 20, 20), font=font(64))
        if strength:
            d.text((30, int(bh * 0.33) + 78), strength, fill=(20, 20, 20), font=font(48))
        d.text((30, int(bh * 0.80)), "EXP 06/2027", fill=(60, 60, 60), font=font(22))
    d.ellipse((bw - 170, 20, bw - 40, 150), fill=tuple(255 - c for c in color))
    if code:
        bar = barcode_image(code, scale=3)
        bar.thumbnail((int(bw * 0.42), int(bh * 0.3)))
        box.paste(bar, (bw - bar.width - 24, int(bh * 0.55)))
    if angle:
        box = box.rotate(angle, expand=True, fillcolor=bg)
    img.paste(box, ((w - box.width) // 2, (h - box.height) // 2))
    return img


def jpeg(img: Image.Image, quality: int = 85) -> bytes:
    out = io.BytesIO()
    img.save(out, "JPEG", quality=quality)
    return out.getvalue()
