---
name: testing-qa
description: Use when writing or running tests for this project (pytest unit/API/device-contract tests against real Postgres in Docker, Jest + React Native Testing Library for the app, the device simulator), or when checking whether a feature is "done".
---

# Testing and QA

## Commands
| Command | What runs |
|---|---|
| `make test` | `test-api` + `test-mobile` |
| `make test-api` | `docker compose run --rm api-test pytest` in the dev image against db `medrem_test` |
| `make test-contract` | `pytest tests/contract -q` |
| `make test-mobile` | `jest --ci` in the mobile container |
| `make sim` | `tools/device-sim` full-day walk-through against the running stack |
| `make eval-vision` | vision accuracy + timing report |

## Backend layout (`services/api/tests/`)
```
conftest.py        settings override, db engine, per-test transaction rollback, client, factories, frozen clock
unit/              pure functions: text.fit, timeutil, adherence math, dedup keys, OCR expiry parse
api/               /api/v1 endpoints through httpx.AsyncClient(ASGITransport(app))
contract/          /api/schedule, /api/scan, /api/events: every field, limit, and event type
vision/            pipeline stages + 10 s budget (marked @pytest.mark.vision, needs models)
vision_samples/    eval photos (see medicine-vision)
```

## Rules
- **Real Postgres, never SQLite.** Tests run inside Docker against the `db` service. The schema is built by Alembic once per session. Each test runs in a SAVEPOINT that is rolled back (`join_transaction_mode="create_savepoint"`).
- Redis: real Redis db index 15, flushed per test. Push sending is mocked (`EXPO_PUSH_ENABLED=false`, assert on the queue).
- **Time is frozen** with `time_machine`: device "today" is 2026-10-30 PH unless a test says otherwise.
- **Factories** in `tests/factories.py` (`make_user`, `make_patient`, `make_medicine`, `make_schedule`, `pair_device`) return ORM objects committed into the test transaction.
- Use `auth_headers(user)` for app requests.
- Tests assert on **behaviour** (status, JSON, DB rows), not on internals.
- Vision tests that need models are marked `vision` and run in `make test` (models are in the image). `-m "not vision"` gives a fast loop.

## Device contract tests (must cover)
- Schedule: exact keys and types; one entry per dose time; sorted; ≤20 cap; only today's days-of-week; inactive/unslotted excluded; ids stable across calls and after a time edit; each text limit at limit, limit+1, and multibyte; empty `doses`; heartbeat updates `last_seen`; unknown device 403; missing device 422.
- Events: every type (`due, taken, missed, expired, opened, closed, scan_ok, scan_expired, scan_unknown, scan_fail`); a duplicate is idempotent (qty decremented once, one alert); doseId 0/missing; `taken` after `missed`; qty never below 0; unknown type accepted; bad time 422; rate limit 429.
- Scan: found shape (exact keys), not-found shape exactly `{"found": false}`, `slot` 0 when unassigned, `low` and `expired` flags, text limits, non-JPEG 415, too large 413, unknown device 403, image saved + `scans` row, answered < 10 s.

## Mobile tests (`apps/mobile/__tests__/`)
- `jest-expo` preset. `@testing-library/react-native` with `render`, `screen.getByRole/ByText`, `userEvent`.
- Mock `expo-secure-store`, `expo-notifications`, `expo-camera`, `expo-router` in `jest.setup.ts`.
- Test: zod schemas (valid/invalid), `qk` keys, API client refresh-once logic, `StatusBadge` (icon + word for each status), the sign-in form's validation messages, medicine form slot conflict error mapping, and timeline rendering of each status.

## Device simulator (`tools/device-sim/sim.py`)
`python sim.py --base http://localhost:5000 day` walks through: poll schedule → `due` → `taken` (checks qty went down) → next dose `due` → `missed` (checks a missed alert exists via `/api/v1` with demo login, < 5 s) → duplicate resend → scan of a sample JPEG (checks the medicine). Other subcommands: `poll`, `event <type> <doseId>`, `scan <file>`, `offline-buffer`. It exits non-zero on any failed check.

## Definition of done (per feature)
- [ ] Acceptance criteria in **product-spec** met, with tests for the API ones
- [ ] `make test` green; contract tests green when device code was touched
- [ ] UI: the **ui-ux** checklist passed (states, a11y, wording)
- [ ] Docs updated (`docs/api.md`, decisions if any)
- [ ] `make up` from clean still works; no secrets or personal data in logs
