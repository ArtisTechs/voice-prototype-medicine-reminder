"""Stage 3 support: package-look embeddings (CLIP). Real model wiring lands with Milestone 6."""


def is_loaded() -> bool:
    return False


def embed_bytes(_image: bytes) -> list[float] | None:
    return None
