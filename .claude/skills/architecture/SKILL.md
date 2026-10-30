---
name: architecture
description: Use when deciding where new code or files go in this monorepo, what may import what, how things are named, or when recording a design decision in docs/decisions.md. Load before creating any new module, folder, service, or endpoint.
---

# Architecture: medicine reminder monorepo

## Repo layout
```
.claude/skills/        project skills (this folder)
apps/mobile/           Expo + TypeScript caregiver app (Expo Router)
services/api/          FastAPI app + worker: one Python package `app`, two entrypoints
  app/main.py          ASGI app factory  -> `uvicorn app.main:app --port 5000`
  app/worker.py        worker entrypoint -> `python -m app.worker`
  app/api/device/      fixed ESP32 endpoints (/api/schedule, /api/scan, /api/events)
  app/api/v1/          caregiver app endpoints (/api/v1/...), incl. ws.py
  app/api/deps.py      shared FastAPI dependencies (db session, current user, access checks)
  app/core/            config, db session, security, logging, errors, redis, ratelimit, time, text
  app/models/          SQLAlchemy ORM models (one file per aggregate)
  app/schemas/         Pydantic v2 request/response models
  app/repositories/    DB queries only (select/insert/update), no business rules
  app/services/        business rules, transactions, side effects (alerts, realtime publish)
  app/vision/          scan pipeline (barcode -> OCR -> embedding -> LLM fallback)
  app/jobs/            APScheduler jobs + push sender (worker only)
  app/realtime/        Redis pub/sub publisher + WebSocket hub
  app/seed.py          demo data (`python -m app.seed`)
  migrations/          Alembic
  scripts/             one-off CLIs (eval_vision.py, make_samples.py)
  tests/               pytest: unit/, api/, contract/, vision/ + vision_samples/
tools/device-sim/      Python script that acts like both ESP32s
firmware/              (if present) ESP32 sketches, read-only, never modify
docs/                  architecture.md, decisions.md, api.md, setup.md
docker-compose.yml (+ .dev.yml, .prod.yml), Caddyfile, Makefile, .env.example
```

## Layering rules (backend), enforced in review
```
api (routers) -> services -> repositories -> models
      \-> schemas <-/                 core <- everything
```
- **Routers** (`api/**`): parse/validate input, call one service function, return a schema. No SQL, no business rules. Device routers also shape the exact contract JSON.
- **Services** may import repositories, models, schemas, core, `realtime.publisher`, `vision`. They own the transaction (`await session.commit()`).
- **Repositories** import models + core only. They never commit, never import services or schemas.
- **Models** import `core.db.Base` only.
- `jobs/` is like a router for the worker: it calls services, it does not hold rules.
- `vision/` does not touch the DB except through `repositories.reference_images` passed in by the scan service.
- Nothing imports from `api/` except `main.py`.
- **Circular import?** You put logic in the wrong layer. Move it down.

## Layering rules (mobile)
- `app/` (routes) -> `src/features/*` (screen pieces, forms) -> `src/api/*` (client, hooks, types) -> `src/lib/*`.
- `src/components/` is the design system. It does not import `src/api`.
- Screens never call `fetch`. They use hooks from `src/api/hooks/`.

## Naming
- **Python:** modules `snake_case.py`. Classes `PascalCase`. Tables are plural snake (`intake_records`). Service functions are verbs (`record_event`, `create_medicine`).
- **Routers:** one file per resource, `router = APIRouter(prefix="/medicines", tags=["medicines"])`.
- **Schemas:** `<Thing>Create`, `<Thing>Update`, `<Thing>Out`. App JSON is camelCase.
- **TS:** components `PascalCase.tsx`, hooks `useThing.ts`, routes kebab or `[param].tsx`.
- **Env vars:** `UPPER_SNAKE`. App-visible ones start with `EXPO_PUBLIC_`.
- **Redis keys:** `rl:<scope>:<id>`, `lock:<job>`, `push:queue`, channel `patient:<id>`.

## Where does new code go?
| You are adding... | Put it in |
|---|---|
| a new app endpoint | `app/api/v1/<resource>.py` + service + schema; register in `app/api/v1/__init__.py`; tests in `tests/api/` |
| a device behaviour | load the **device-contract** skill first; `app/api/device/` + `services/device_*.py` |
| a rule that runs on a timer | `app/jobs/` (see **notifications-jobs**) |
| a table or column | `app/models/` + an Alembic migration (see **database**) |
| a new screen | `apps/mobile/app/...` route + `src/features/<area>/` (see **mobile-expo**, **ui-ux**) |
| a compose service or env var | compose files + `.env.example` + `docs/setup.md` (see **docker-devops**) |

## Recording decisions
When something is unclear, pick the sensible option and append it to `docs/decisions.md`:
```
## D<n>. <short title>
- **Context:** <what was unclear>
- **Choice:** <what we did>
- **Why:** <one or two sentences>
```
Number decisions in order and never rewrite old ones. When a decision is reversed, add a new one that says so.

## Commits
Commit at the end of each milestone: `feat(m2): domain CRUD for patients, medicines, schedules`. Never commit `.env`, `data/`, or scan images.
