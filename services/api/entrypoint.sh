#!/bin/sh
# API container start: wait for db -> migrate -> optional seed -> exec the given command.
set -e

python - <<'EOF'
import asyncio, sys, time
import asyncpg
from app.core.config import get_settings

url = get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")

async def wait():
    for _ in range(60):
        try:
            conn = await asyncpg.connect(url)
            await conn.close()
            return
        except Exception:
            time.sleep(1)
    sys.exit("database not reachable")

asyncio.run(wait())
EOF

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  alembic upgrade head
fi
if [ "${SEED_DEMO:-false}" = "true" ]; then
  python -m app.seed
fi

exec "$@"
