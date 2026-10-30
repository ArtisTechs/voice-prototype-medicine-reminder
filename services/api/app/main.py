from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.device.routes import router as device_router
from app.api.v1 import router as v1_router
from app.core.config import get_settings
from app.core.db import dispose_engine, session_scope
from app.core.errors import install_error_handlers
from app.core.logging import get_logger, setup_logging
from app.core.redis import close_redis, get_redis

log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    s.check_prod()
    if s.vision_enabled:
        from app.vision import models

        await models.load_models()
        from app.services import reference_service

        async with session_scope() as db:
            await reference_service.backfill_embeddings(db)
    yield
    await close_redis()
    await dispose_engine()


def create_app() -> FastAPI:
    s = get_settings()
    setup_logging(s.log_level)
    app = FastAPI(
        title="Medicine Reminder API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if s.enable_docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if s.enable_docs else None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)
    app.include_router(device_router)
    app.include_router(v1_router)

    @app.get("/healthz", tags=["health"])
    async def healthz():
        db_ok = redis_ok = False
        try:
            async with session_scope() as db:
                await db.execute(text("select 1"))
            db_ok = True
        except Exception:
            log.warning("health_db_failed")
        try:
            redis_ok = bool(await get_redis().ping())
        except Exception:
            log.warning("health_redis_failed")
        ok = db_ok and redis_ok
        return JSONResponse(
            {"status": "ok" if ok else "degraded", "db": db_ok, "redis": redis_ok}, status_code=200 if ok else 503
        )

    return app


app = create_app()
