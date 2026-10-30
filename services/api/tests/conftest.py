"""Test harness: real Postgres (medrem_test) + real Redis (db 15), each test rolled back.

All sessions (request handlers, services, jobs) share one connection with an outer transaction;
service-level commits become SAVEPOINT releases, so nothing leaks between tests."""

import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime

os.environ.setdefault("ENV", "test")
os.environ.setdefault("VISION_ENABLED", "false")
os.environ.setdefault("EXPO_PUSH_ENABLED", "false")
os.environ.setdefault("SCAN_DIR", "/tmp/scans")
os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-123456")

import pytest
import time_machine
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core import db as core_db
from app.core.config import get_settings
from app.core.redis import get_redis, set_redis
from app.core.security import create_token

# Device "now": 2026-10-30 07:00 Asia/Manila (= 2026-10-29 23:00 UTC), a Friday.
FROZEN_UTC = datetime(2026, 10, 29, 23, 0, tzinfo=UTC)


@pytest.fixture(scope="session", autouse=True)
def _migrated() -> None:
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "migrations"))
    os.environ["ALEMBIC_DATABASE_URL"] = get_settings().database_url
    if os.environ.get("TEST_RESET_SCHEMA"):
        command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")


@pytest.fixture(scope="session")
async def engine():
    eng = create_async_engine(get_settings().database_url)
    yield eng
    await eng.dispose()


@pytest.fixture
def frozen():
    with time_machine.travel(FROZEN_UTC, tick=True) as traveller:
        yield traveller


@pytest.fixture
async def db(engine, frozen) -> AsyncIterator[AsyncSession]:
    async with engine.connect() as conn:
        trans = await conn.begin()
        factory = async_sessionmaker(
            bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        previous = core_db._sessionmaker
        core_db.set_sessionmaker(factory)
        async with factory() as session:
            yield session
        if previous:
            core_db.set_sessionmaker(previous)
        await trans.rollback()


@pytest.fixture(autouse=True)
async def redis():
    set_redis(None)
    r = get_redis()
    await r.flushdb()
    yield r
    await r.flushdb()
    await r.aclose()
    set_redis(None)


@pytest.fixture
async def client(db) -> AsyncIterator[AsyncClient]:
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def auth_headers(user) -> dict[str, str]:
    token, _, _ = create_token(user.id, "access")
    return {"Authorization": f"Bearer {token}"}
