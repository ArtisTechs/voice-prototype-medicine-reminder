#!/bin/sh
# API/worker container start: migrate (waits for the database) -> optional demo seed -> exec the command.
set -e

# Cloud MySQL (Aiven, ...) is signed by its own CA: paste the CA certificate into DATABASE_CA_CERT
# (real newlines or literal \n) and it is written to a file and added to DATABASE_URL as sslcert.
if [ -n "${DATABASE_CA_CERT:-}" ]; then
  printf '%b\n' "$DATABASE_CA_CERT" > /tmp/db-ca.pem
  case "$DATABASE_URL" in
    *sslcert=*) ;;
    *\?*) export DATABASE_URL="${DATABASE_URL}&sslcert=/tmp/db-ca.pem" ;;
    *) export DATABASE_URL="${DATABASE_URL}?sslcert=/tmp/db-ca.pem" ;;
  esac
fi

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
