---
name: docker-devops
description: Use when changing Docker Compose services, Dockerfiles, dev vs prod compose files, health checks, volumes, .env handling, Makefile targets, Caddy, or making ports 5000/8081 reachable from the LAN (ESP32 and phone) on Windows.
---

# Docker and DevOps

## Services
| service | image | ports (host) | notes |
|---|---|---|---|
| db | `pgvector/pgvector:pg16` | none (dev: 5432 on 127.0.0.1) | volume `pgdata`, `db/init.sql` creates `medrem_test` + `vector` ext; healthcheck `pg_isready` |
| redis | `redis:7.4-alpine` | none | healthcheck `redis-cli ping`; no persistence needed |
| api | `services/api` target `runtime` | **0.0.0.0:5000** | `entrypoint.sh`: wait for db → `alembic upgrade head` → seed if `SEED_DEMO=true` → uvicorn; healthcheck `/healthz` |
| worker | same image | none | `command: python -m app.worker`, `VISION_ENABLED=false`, depends on api healthy (migrations done) |
| mobile (dev) | `apps/mobile` Dockerfile | 8081 (+19000-19002 legacy) | `npx expo start --lan`, `REACT_NATIVE_PACKAGER_HOSTNAME=${LAN_IP}` |
| adminer (dev) | `adminer:4.8.1` | 127.0.0.1:8089 (`ADMINER_PORT`) | dev only |
| caddy (prod) | `caddy:2.8-alpine` | 80, 443 | HTTPS → api:5000 for the app; ESP32 still uses http://LAN:5000 |

## Compose files
- `docker-compose.yml`: base, prod-safe values, no bind mounts.
- `docker-compose.dev.yml`: bind-mounts `services/api/app` + `migrations` + `tests`, `uvicorn --reload`, adminer, mobile, db port on localhost, `ENABLE_DOCS=true`.
- `docker-compose.prod.yml`: `restart: unless-stopped`, Caddy, no adminer/mobile/reload, `SEED_DEMO=false`, resource limits.
- Make targets choose: `DEV = -f docker-compose.yml -f docker-compose.dev.yml`.

## Dockerfiles
- Multi-stage, pinned bases (`python:3.12-slim-bookworm`, `node:22-bookworm-slim`, `ghcr.io/astral-sh/uv:0.8`).
- **API stages:** `base` (OS libs: libgl1, libglib2.0-0 for OCR) → `deps` (`uv sync --frozen --no-dev`, CPU torch index) → `models` (download CLIP weights into `/opt/models`) → `runtime` (copy venv + models + app, user `app` uid 10001) → `dev` (adds dev deps).
- A `.dockerignore` in each context (`.venv`, `node_modules`, `__pycache__`, `.env`, `data/`).
- Non-root user. Writable dirs are only `/data` (scans volume) and `/tmp`.

## Volumes
`pgdata` (db), `scans` (`/data/scans`, scan + reference images), `mobile_node_modules`, `caddy_data`. `make down` keeps them; `make nuke` removes them (asks first).

## .env
- `.env.example` is committed and complete, with a comment for each variable. `.env` is git-ignored.
- **Required to edit:** `LAN_IP` (the PC's WiFi IPv4), `JWT_SECRET` (`make secret` prints one), `POSTGRES_PASSWORD`.
- `EXPO_PUBLIC_API_URL` defaults to `http://${LAN_IP}:5000`.
- Compose reads `.env` automatically. Services get `env_file: .env`.

## Makefile targets
`up, down, logs, logs-api, logs-mobile, ps, build, migrate, revision m=.., seed, reset-seed, test, test-api, test-contract, test-mobile, sim, eval-vision, shell-api, mobile-sh, psql, secret, prod-up, prod-down, nuke`.
Each target is a one-liner over `docker compose`, so you can paste the same command on Windows without make.

## LAN reachability on Windows
1. `ipconfig` → "Wireless LAN adapter Wi-Fi" → IPv4 (e.g. 192.168.1.20) → `LAN_IP` in `.env`.
2. Docker Desktop publishes on all interfaces (`0.0.0.0:5000`).
3. Firewall (admin PowerShell):
   `New-NetFirewallRule -DisplayName "MedRem API 5000" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow -Profile Private`
   (same for 8081). The WiFi network profile must be **Private**.
4. Test from the phone browser: `http://<LAN_IP>:5000/healthz`.
5. ESP32: set `BACKEND_URL` to `http://<LAN_IP>:5000` in the main sketch. Reserve the PC's IP in the router (DHCP reservation) so it does not change.

## Health checks
Every long-running service has one. `api` depends on `db: service_healthy` + `redis: service_healthy`; `worker` depends on `api: service_healthy`. `/healthz` returns 200 `{"status":"ok","db":true,"redis":true}`, or 503 if either is down.

## Checklist for a compose change
- [ ] `make down && make up` from a fresh clone works (`cp .env.example .env` only)
- [ ] New env var in `.env.example` + `docs/setup.md`
- [ ] Ports still published on 0.0.0.0:5000; health checks green in `make ps`
