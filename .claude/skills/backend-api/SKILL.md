---
name: backend-api
description: Use when writing Express + TypeScript code in services/api: routes, services, repositories, zod schemas, the route() helper, the error format, pagination, OpenAPI docs, API versioning (/api/v1 vs fixed device paths), and settings from environment variables.
---

# Backend API conventions (Express 5, TypeScript, Node 22)

## Layers (see **architecture**)
`route → service → repository → Prisma`. The route validates and shapes the response, the service decides and runs transactions, the repository runs the queries.

```ts
// src/routes/v1/medicines.ts
route(medicinesRouter, 'post', '/patients/:patientId/medicines',
  { tag: 'medicines', summary: 'Add a medicine', body: medicineCreate, status: 201 },
  async ({ params, body }) => medicineService.toOut(await medicineService.create(params.patientId, body)));
```
```ts
// src/services/medicineService.ts
export async function create(patientId: number, data: MedicineCreate) {
  await checkSlot(patientId, data.slot);                      // throws conflict('slot_taken', ...)
  const med = await medRepo.create({ patientId, ...fields });
  await publish(patientId, 'medicine.updated', { medicineId: med.id });   // after the write
  return get(patientId, med.id);
}
```

## `route()` (`src/core/http.ts`)
Every `/api/v1` route goes through it. It does, in order: bearer auth (`auth: true` is the default) → numeric `:params` → **patient access** (any path with `:patientId` checks the caregiver's link and answers 404 for strangers; `owner: true` also needs the owner role) → zod parse of `body` / `query` (422 `validation_error`) → your handler. The handler returns the JSON body; `status: 204` returns nothing. Because it registers each route in `registry`, `tests/api/security.test.ts` can prove that no route is unguarded. Do not write raw `router.get(...)` for `/api/v1`.

Device routes (`src/routes/device/index.ts`) are plain Express handlers on purpose: the firmware, not the app, defines them (see **device-contract**).

## Schemas (zod, `src/schemas/`)
- Request JSON is camelCase. `XCreate` has required fields with limits; `XUpdate` has every field optional and is applied only for keys that are present (`undefined` = leave alone, `null` = clear, for nullable columns).
- Blank text from forms becomes `null` (`optText` in `schemas/common.ts`).
- Responses are built by service/route code as plain objects (camelCase). There is no response schema layer; the API tests pin the shapes.
- Device schemas (`schemas/device.ts`) match the contract field for field.

## Errors
One shape everywhere:
```json
{"error": {"code": "slot_taken", "message": "Slot 2 already has a medicine.", "details": null}}
```
- Throw the helpers from `src/core/errors.ts`: `notFound` 404, `conflict` 409, `badRequest` 400, `unauthorized` 401, `forbidden` 403, `tooLarge` 413, `unsupportedMedia` 415, `rateLimited` 429.
- zod failures → 422 `validation_error` with `details=[{field, message}]` (`field` is the camelCase path, e.g. `doseAmount`). Bad JSON → 422. Unhandled → 500 `internal_error` (logged with the error class and stack, never the body).
- Something the caregiver may not see → **404**, not 403.

## Pagination
Lists that can grow (`alerts`, `scans`) take `?limit=50&offset=0` (limit ≤ 200) and return `{items, total, limit, offset}`. Small fixed lists (medicines, schedules) return arrays.

## Versioning and paths
- `/api/v1/...` is the app API. Breaking changes go in `/api/v2`; never change v1 in place.
- `/api/schedule`, `/api/scan`, `/api/events` are the device API, frozen. With `DEVICE_PATH_SECRET` set they live under `/d/<secret>/`.
- `/api/v1/ws?token=` is the WebSocket (`src/realtime/wsServer.ts`). `/healthz` checks MySQL + Redis.
- **OpenAPI** is built from the route registry and served at `/docs` + `/openapi.json` only when `ENABLE_DOCS=true` (dev). Tags: `auth, me, patients, invites, devices, medicines, schedules, today, history, alerts, scans, dashboard, device-firmware`.

## Settings (`src/core/config.ts`)
One zod schema over `process.env`; `settings()` parses once and the result is shared (tests may change fields). Every new variable goes in `.env.example` with a comment and in `docs/setup.md`. Groups: `DATABASE_URL`, `REDIS_URL`, `JWT_*`, `DEVICE_*`, `SCAN_*`, `GEMINI_*`, `EXPO_*`, `CORS_ORIGINS`, `MYSQL_*` (compose only).

## Async and time
- Everything async; never block the event loop (sharp and argon2 already run off-thread).
- Time comes from `utcnow()` / `deviceToday()` in `src/core/timeutil.ts` so tests can freeze `Date`. Never `new Date(string)` for wall-clock values; use the helpers.
- Transactions: `prisma.$transaction(async (tx) => ...)` and pass `tx` to repositories (they take an optional `db`). Publish realtime/push **after** the transaction commits.

## Logging
`getLogger('name')` (pino JSON lines). Log ids, counts and timings only; never names, emails, tokens, medicine names or package text (`logger.ts` redacts the usual keys as a second line of defence).

## Endpoint checklist
- [ ] `route()` with tag, summary, schemas and status code
- [ ] Service owns the transaction; realtime publish after it
- [ ] API test: happy path, validation error, another caregiver → 404
- [ ] `docs/api.md` updated
