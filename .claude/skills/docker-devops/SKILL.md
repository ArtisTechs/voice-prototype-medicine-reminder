---
name: docker-devops
description: Use when changing Docker Compose services, Dockerfiles, dev vs prod compose files, health checks, volumes, .env handling, Makefile targets, Caddy, or making ports 5055/8081 reachable from the LAN (ESP32 and phone) on Windows.
---

# Docker and DevOps

## Services
| service | image | ports (host) | notes |
|---|---|---|---|
| db | `mysql:8.4` | none (dev: 3306 on 127.0.0.1) | volume `dbdata`; `db/init-test-db.sh` creates `medrem_test` on first start; healthcheck `mysqladmin ping` |
| redis | `redis:7.4-alpine` | none | healthcheck `redis-cli ping`; no persistence needed |
| api | `services/api` target `runtime` | **0.0.0.0:5055** (`API_PORT` override only for local clashes) | `entrypoint.sh`: `prisma migrate deploy` (retries until MySQL is up) → seed if `SEED_DEMO=true` → `node dist/src/server.js`; healthcheck `/healthz` |
| worker | same image | none | `node dist/src/worker.js` (node-cron jobs + Expo push consumer), `RUN_MIGRATIONS=false`, depends on api healthy |
| mobile (dev) | `apps/mobile` Dockerfile | 8081 | `npx expo start --lan --go` (`EXPO_CLIENT=dev-client` for the dev build), `REACT_NATIVE_PACKAGER_HOSTNAME=${LAN_IP}`; source mounted read-only at `/host` and synced into `/app`, because Windows bind mounts have no file events |
| adminer (dev) | `adminer:4.8.1` | 127.0.0.1:8089 | dev only; server `db` |
| api-test, sim (dev, profile `test`) | dev image / `node:22` | none | `make test-api`, `make sim` |
| caddy (prod) | `caddy:2.8-alpine` | 80, 443 | HTTPS → api:5055 for the app; the ESP32 still uses http://LAN:5055 |

## Compose files
- `docker-compose.yml`: base, prod-safe values, no bind mounts.
- `docker-compose.dev.yml`: bind-mounts `services/api/{src,prisma,scripts,tests}` (`tsx watch` with polling, because of Windows), adminer, mobile, db port on localhost, `ENABLE_DOCS=true`.
- `docker-compose.prod.yml`: `restart: unless-stopped`, Caddy, no adminer/mobile/reload, `SEED_DEMO=false`, resource limits.
- Make targets choose: `DEV = -f docker-compose.yml -f docker-compose.dev.yml`.

## Dockerfile (`services/api/Dockerfile`)
Stages: `base` (node:22.21.1-bookworm-slim + openssl, user `app` uid 10001) → `deps` (`npm ci`, `prisma generate`) → `build` (`tsc` into `dist/`) → `prod-deps` (`npm ci --omit=dev`; the `prisma` CLI is a dependency because the entrypoint migrates) → `runtime` (dist + prod node_modules + `prisma/migrations` + `seed_assets`) / `dev` (all deps; source is mounted by compose). Non-root; the only writable paths are `/data` (scans volume) and `/tmp`. `.dockerignore` excludes `node_modules`, `dist`, `.env`, `tests`. uid 10001 is kept from the old image so an existing `scans` volume stays writable.

## Volumes
`dbdata` (MySQL), `scans` (`/data/scans`: scan photos + reference photos), `mobile_node_modules`, `caddy_data`. `make down` keeps them; `make nuke` removes them (asks first).

## .env
- `.env.example` is committed and complete, each variable commented. `.env` is git-ignored.
- **To edit:** `LAN_IP` (the PC's WiFi IPv4), `JWT_SECRET` (`make secret`), `MYSQL_PASSWORD` / `MYSQL_ROOT_PASSWORD`, `GEMINI_API_KEY` (scans only work with it).
- `EXPO_PUBLIC_API_URL` defaults to `http://${LAN_IP}:${API_PORT:-5055}`. `start-voice.cmd` (scripts/start.ps1) detects `LAN_IP` on every start and upgrades an `.env` from the PostgreSQL version; the device always uses the hotspot address `192.168.137.1:5055`. `setup-voice.cmd` opens 5055/8081 on all firewall profiles.
- Compose reads `.env` automatically; services also get `env_file: .env`. `DATABASE_URL` is built from `MYSQL_*` unless you set it (URL-encode special characters).

## Makefile targets
`up, down, logs, logs-api, logs-mobile, ps, build, migrate, revision m=.., seed, reset-seed, test, test-api, test-contract, test-mobile, typecheck, sim, eval-vision, shell-api, mobile-sh, mysql, secret, prod-up, prod-down, nuke`. Each is a one-liner over `docker compose`, so the same command works on Windows without make.

## LAN reachability on Windows
1. `ipconfig` → Wi-Fi IPv4 (e.g. 192.168.1.20) → `LAN_IP` in `.env`.
2. Docker Desktop publishes on all interfaces (`0.0.0.0:5055`).
3. Firewall (admin PowerShell): `New-NetFirewallRule -DisplayName "VOICE API 5055" -Direction Inbound -Protocol TCP -LocalPort 5055 -Action Allow -Profile Private` (same for 8081), or run `setup-voice.cmd`. The WiFi profile must be **Private**.
4. From the phone browser: `http://<LAN_IP>:5055/healthz`.
5. ESP32: set `BACKEND_URL` to `http://<LAN_IP>:5055` in the main sketch. Reserve the PC's IP in the router so it does not change.

## Health checks
Every long-running service has one. `api` waits for `db` and `redis` healthy; `worker` waits for `api`. `/healthz` returns 200 `{"status":"ok","db":true,"redis":true}` or 503.

## Checklist for a compose change
- [ ] `make down && make up` from a fresh clone works (`cp .env.example .env` only)
- [ ] New env var in `.env.example` + `docs/setup.md`
- [ ] Ports still published on 0.0.0.0:5055; health checks green in `make ps`
