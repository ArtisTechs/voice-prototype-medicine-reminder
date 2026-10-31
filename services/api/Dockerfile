# syntax=docker/dockerfile:1.7
# VOICE API + worker. Stages: base -> deps -> models -> runtime (prod) / dev (tests, reload).

FROM ghcr.io/astral-sh/uv:0.8 AS uv

FROM python:3.12-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never \
    VIRTUAL_ENV=/opt/venv UV_PROJECT_ENVIRONMENT=/opt/venv PATH=/opt/venv/bin:$PATH \
    HF_HOME=/opt/models/hf XDG_CACHE_HOME=/opt/models/cache TORCH_HOME=/opt/models/torch
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /srv

FROM base AS deps
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project

FROM deps AS models
# Bake the CLIP weights into the image so nothing downloads at runtime (LAN-only demo).
COPY scripts/download_models.py /tmp/download_models.py
RUN python /tmp/download_models.py

FROM base AS runtime
# Weights are baked in at /opt/models; never call the Hugging Face Hub at runtime.
ENV HF_HUB_OFFLINE=1
RUN groupadd -g 10001 app && useradd -u 10001 -g app -m -d /home/app app \
 && mkdir -p /data/scans && chown -R app:app /data
COPY --from=deps /opt/venv /opt/venv
COPY --from=models /opt/models /opt/models
COPY --chown=app:app . /srv
RUN chmod +x /srv/entrypoint.sh
USER app
EXPOSE 5000
ENTRYPOINT ["/srv/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5000", "--proxy-headers", "--forwarded-allow-ips=*"]

FROM runtime AS dev
USER root
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project \
 && chown -R app:app /opt/venv
USER app
