---
name: testing-qa
description: Use when writing or running tests for this project (Vitest + Supertest unit/API/device-contract tests against a real MySQL and Redis in Docker, Jest + React Native Testing Library for the app, the device simulator), or when checking whether a feature is "done".
---

# Testing and QA

## Commands
| Command | What runs |
|---|---|
| `make test` | `test-api` + `test-mobile` |
| `make test-api` | `docker compose run --rm api-test npm test` (Vitest) in the dev image against database `medrem_test` |
| `make test-contract` | `vitest run tests/contract` |
| `make typecheck` | `tsc --noEmit` |
| `make test-mobile` | `jest --ci` in the mobile container |
| `make sim` | `tools/device-sim` full-day walk-through against the running stack |
| `make eval-vision` | scan accuracy + timing against the real Gemini model (needs the key) |

Outside Docker (WSL/Linux/macOS): start MySQL + Redis, then `DATABASE_URL=mysql://…/medrem_test REDIS_URL=redis://…:6379 npm test` in `services/api`.

## Backend layout (`services/api/tests/`)
```
global-setup.ts   refuses non-*_test databases, runs `prisma migrate deploy` once
setup.ts          per test: frozen clock, empty database, flushed Redis db 15, FakeVision
helpers.ts        api(), auth(user), makeUser/makePatient/pairDevice/makeMedicine/makeSchedule, setup(), jpeg(), FakeVision, ph()
unit/             pure functions: text.fit, fuzzy match, Gemini reply parsing
api/              /api/v1 endpoints through Supertest(createApp())
contract/         /api/schedule, /api/scan, /api/events, DEVICE_PATH_SECRET: every field, limit and event type
vision/           scan review/correction and pipeline rules
vision_samples/   photos for `make eval-vision`
```

## Rules
- **Real MySQL and Redis, never mocks of them.** The only fake is Gemini (`FakeVision`) and the Expo push HTTP call (an injected `fetch`).
- **Time is frozen** with `vi.useFakeTimers({ toFake: ['Date'] })`: device "today" is **2026-10-30 07:00 PH, a Friday**. Move it with `vi.setSystemTime(ph(8, 36))`. Only `Date` is faked, so real timers and DB I/O work. Measure real elapsed time with `performance.now()`.
- Each test starts from an empty database (cascading `DELETE`); tests in a file run one after another (`fileParallelism: false`).
- `setup()` in `helpers.ts` gives the standard fixture: caregiver, patient, paired `pillbox`, Losartan (slot 1, 08:00), Metformin (slot 2, **low**, 08:00 + 20:00), Amlodipine (slot 3, **expired**, 13:00).
- Use `auth(user)` for app requests. Tokens are made at call time, so they stay valid after moving the clock.
- Assert behaviour (status, JSON, DB rows), not internals. `tests/api/security.test.ts` asserts on the route registry: every route is guarded, every `:patientId` route checks the link.

## Device contract tests (must cover)
- Schedule: exact keys and types; one entry per dose time; sorted; ≤20 cap; only today's weekday; inactive/unslotted excluded; ids stable across calls and after a time edit; each text limit; empty `doses`; heartbeat updates `last_seen`; unknown device 403 `device_not_registered`; missing device 422; shared box prefixes.
- Events: every type (`due, taken, missed, expired, opened, closed, scan_ok, scan_expired, scan_unknown, scan_fail`); duplicates idempotent (qty decremented once, one alert); doseId 0/missing; `taken` after `missed`; qty never below 0; unknown type accepted; bad time 422; rate limit 429; 8 buffered events resent.
- Scan: exact found keys, exact `{"found":false}`, `slot` 0 when unassigned, `low`/`expired`, text limits, non-JPEG 415, too large 413, unknown device 403, image saved + `scans` row, every Gemini failure → 200, inside the budget.

## Mobile tests (`apps/mobile/__tests__/`)
`jest-expo` + `@testing-library/react-native`; `expo-secure-store`, `expo-notifications`, `expo-camera`, `expo-router` are mocked in `jest.setup.ts`. Cover zod schemas, query keys, the API client's refresh-once logic, `StatusBadge` (icon + word), form validation messages, slot-conflict mapping, and the timeline statuses.

## Device simulator (`tools/device-sim/sim.mjs`, Node 22, no dependencies)
`node sim.mjs --base http://localhost:5055 day` walks through: poll schedule → `due` → `taken` (qty went down) → next dose `due` → `missed` (a missed alert appears via the app API within 5 s) → duplicate resend → scan of a sample JPEG (identifies the medicine; **needs `GEMINI_API_KEY` on the server**). Other commands: `poll`, `watch`, `event <type> <doseId>`, `scan <file>`, `offline-buffer`. Exit code 1 on any failed check.

## Definition of done (per feature)
- [ ] Acceptance criteria in **product-spec** met, with tests for the API ones
- [ ] `make test` and `make typecheck` green; contract tests green when device code was touched
- [ ] UI: the **ui-ux** checklist passed (states, a11y, wording)
- [ ] Docs updated (`docs/api.md`, `docs/decisions.md` if a choice was made)
- [ ] `make up` from clean still works; no secrets or personal data in logs
