"""Image files on the scans volume. Paths are always generated, never taken from input."""

import io
import os
import uuid
from pathlib import Path

from PIL import Image

from app.core.config import get_settings

JPEG_MAGIC = b"\xff\xd8\xff"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def root() -> Path:
    return Path(get_settings().scan_dir)


def is_jpeg(data: bytes) -> bool:
    return data[:3] == JPEG_MAGIC


def is_image(data: bytes) -> bool:
    return is_jpeg(data) or data[:8] == PNG_MAGIC


def new_rel_path(kind: str, when) -> str:
    return f"{kind}/{when:%Y/%m}/{uuid.uuid4().hex}.jpg"


def write_bytes(rel: str, data: bytes) -> None:
    path = root() / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def reencode_jpeg(data: bytes, max_side: int = 1280) -> bytes:
    """Strips EXIF/GPS and normalises size for reference images."""
    img = Image.open(io.BytesIO(data))
    img = img.convert("RGB")
    img.thumbnail((max_side, max_side))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=85)
    return out.getvalue()


def read_bytes(rel: str) -> bytes:
    return (root() / rel).read_bytes()


def delete(rel: str) -> None:
    try:
        (root() / rel).unlink()
    except FileNotFoundError:
        pass
