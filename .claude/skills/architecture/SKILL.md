---
name: architecture
description: Use when deciding where new code or files go in this monorepo, what may import what, how things are named, or when recording a design decision in docs/decisions.md. Load before creating any new module, folder, service, or endpoint.
---

# Architecture: VOICE monorepo

## Repo layout
```
.claude/skills/        project skills (this folder)
apps/mobile/           Expo + TypeScript caregiver app (Expo Router)
services/api/          Express 5 + TypeScript: API and worker, one package, two entrypoints
  src/server.ts        API entrypoint     -> `node dist/src/server.js` (port 5055)
  src/worker.ts        worker entrypoint  -> `node dist/src/worker.js`
  src/app.ts           Express app factory (createApp), used by server and tests
  src/routes/device/   fixed ESP32 endpoints (/api/schedule, /api/scan, /api/events)
  src/routes/v1/       caregiver app endpoints (/api/v1/...), built with core/http.ts route()
  src/core/            config, prisma, redis, http (route helper + registry), errors, security, logger, ratelimit, timeutil, text, storage, docs, deviceSecret
  src/schemas/         zod request schemas (+ the frozen device contract)
  src/repositories/    Prisma queries only, no business rules
  src/services/        business rules, transactions, side effects (alerts, realtime publish)
  src/vision/          scan pipeline: gemini.ts (the call), match.ts (fuzzy), pipeline.ts (checks + budget)
  src/jobs/            node-cron scheduler, push sender, locks (worker only)
  src/realtime/        Redis pub/sub publisher + WebSocket hub/server
  prisma/              schema.prisma, migrations/, seed.ts (demo data)
  scripts/             one-off CLIs (eval-vision.ts)
  seed_assets/         reference photos for the demo medicines
  tests/               Vitest: unit/, api/, contract/, vision/ + vision_samples/
tools/device-sim/      sim.mjs (Node): acts like both ESP32s
firmware/              (if present) ESP32 sketches, read-only, never modify
docs/                  architecture.md, decisions.md, api.md, setup.md
docker-compose.yml (+ .dev.yml, .prod.yml), Caddyfile, Makefile, .env.example
```

## Layering rules (backend), enforced in review
```
routes -> services -> repositories -> Prisma
      -> schemas <-/                 core <- everything
```
- **Routes** (`routes/**`): validate input (zod), call one service function, return the JSON. No Prisma calls, no business rules. Device routes also shape the exact contract JSON.
- **Services** may import repositories, schemas, core, `realtime/publisher`, `vision`, `jobs/locks`. They own the transaction (`prisma.$transaction`) and publish realtime/push after it commits.
- **Repositories** import `core/prisma`, `core/timeutil` and Prisma types only. They never open a transaction, never import services.
- `jobs/` is like a route for the worker: it calls services, it does not hold rules.
- `vision/` never touches the database. The scan service passes candidates in and reads the matched row itself.
- Nothing imports from `routes/` except `app.ts`.
- **Circular import?** You put logic in the wrong layer. Move it down.

## Layering rules (mobile)
- `app/` (routes) -> `src/features/*` (screen pieces, forms) -> `src/api/*` (client, hooks, types) -> `src/lib/*`.
- `src/components/` is the design system. It does not import `src/api`.
- Screens never call `fetch`. They use hooks from `src/api/hooks/`.

## Naming
- **TypeScript (backend):** files `camelCase.ts` (`deviceService.ts`), one export per concern. Tables are plural snake_case via Prisma `@@map` (`intake_records`). Service functions are verbs (`recordEvent`, `create`).
- **Routes:** one file per resource in `routes/v1/`, registered in `routes/v1/index.ts`; paths relative to `/api/v1`.
- **Schemas:** `<thing>Create`, `<thing>Update` (zod). App JSON is camelCase.
- **TS:** components `PascalCase.tsx`, hooks `useThing.ts`, routes kebab or `[param].tsx`.
- **Env vars:** `UPPER_SNAKE`. App-visible ones start with `EXPO_PUBLIC_`.
- **Redis keys:** `rl:<scope>:<id>`, `lock:<job>`, `push:queue`, channel `patient:<id>`.

## Where does new code go?
| You are adding... | Put it in |
|---|---|
| a new app endpoint | `routes/v1/<resource>.ts` using `route()` + service + zod schema; register in `routes/v1/index.ts`; tests in `tests/api/` |
| a device behaviour | load the **device-contract** skill first; `routes/device/` + `services/deviceService.ts` |
| a rule that runs on a timer | `jobs/scheduler.ts` calling a `services/monitorService.ts` function (see **notifications-jobs**) |
| a table or column | `prisma/schema.prisma` + a reviewed migration (see **database**) |
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
