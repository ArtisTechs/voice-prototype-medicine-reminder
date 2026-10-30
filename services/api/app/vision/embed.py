"""Stage 3: package-look embeddings with open_clip ViT-B-32 (CPU), compared in pgvector (cosine)."""

import io
import threading

from PIL import Image

from app.core.config import get_settings

_model = None
_preprocess = None
_lock = threading.Lock()


def load() -> None:
    global _model, _preprocess
    import open_clip
    import torch

    torch.set_num_threads(2)
    s = get_settings()
    model, _, preprocess = open_clip.create_model_and_transforms(s.vision_clip_model, pretrained=s.vision_clip_pretrained)
    model.eval()
    _model, _preprocess = model, preprocess


def is_loaded() -> bool:
    return _model is not None


def embed_image(img: Image.Image) -> list[float] | None:
    if _model is None:
        return None
    import torch

    with _lock, torch.no_grad():
        x = _preprocess(img.convert("RGB")).unsqueeze(0)
        v = _model.encode_image(x)
        v = v / v.norm(dim=-1, keepdim=True)
    return v[0].tolist()


def embed_bytes(image: bytes) -> list[float] | None:
    if _model is None:
        return None
    return embed_image(Image.open(io.BytesIO(image)))


def pick(nearest: list[tuple[int, float]], threshold: float, margin: float) -> tuple[int, float] | None:
    """Best similarity per medicine; confident only if above threshold and ahead of the next medicine."""
    best: dict[int, float] = {}
    for mid, sim in nearest:
        best[mid] = max(best.get(mid, -1.0), sim)
    ranked = sorted(best.items(), key=lambda kv: kv[1], reverse=True)
    if not ranked or ranked[0][1] < threshold:
        return None
    if len(ranked) > 1 and ranked[0][1] - ranked[1][1] < margin:
        return None
    return ranked[0]
