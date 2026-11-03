#!/bin/sh
# API/worker container start: migrate (waits for the database) -> optional demo seed -> exec the command.
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  tries=0
  until npx prisma migrate deploy; do
    tries=$((tries + 1))
    if [ "$tries" -ge 30 ]; then echo "database not reachable or migration failed" >&2; exit 1; fi
    echo "waiting for the database... ($tries)"
    sleep 2
  done
fi

if [ "${SEED_DEMO:-false}" = "true" ]; then
  ${SEED_CMD}
fi

exec "$@"
