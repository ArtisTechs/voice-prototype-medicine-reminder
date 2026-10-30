import asyncio
import os

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

import app.models  # noqa: F401  (registers tables)
from app.core.config import get_settings
from app.core.db import Base

config = context.config
target_metadata = Base.metadata


def url() -> str:
    return os.environ.get("ALEMBIC_DATABASE_URL") or get_settings().database_url


def run_offline() -> None:
    context.configure(url=url(), target_metadata=target_metadata, literal_binds=True, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def _sync(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_online() -> None:
    connectable = config.attributes.get("connection")
    if connectable is not None:
        await connectable.run_sync(_sync)
        return
    engine = create_async_engine(url())
    async with engine.connect() as conn:
        await conn.run_sync(_sync)
    await engine.dispose()


if context.is_offline_mode():
    run_offline()
else:
    asyncio.run(run_online())
