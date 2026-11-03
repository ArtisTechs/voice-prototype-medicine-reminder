---
name: database
description: Use when adding or changing tables, columns, indexes, queries, Prisma migrations, or seed data in services/api (MySQL 8.4 + Prisma 6). Also covers UTC timestamps and Philippine local time handling.
---

# Database conventions

## Stack
MySQL 8.4 (`mysql:8.4`, utf8mb4), Prisma 6 (`prisma-client-js`), schema in `services/api/prisma/schema.prisma`, migrations in `prisma/migrations/` (committed). Redis is separate (cache, locks, pub/sub, the unpaired-box list).

## Model conventions
```prisma
model Medicine {
  id        Int      @id @default(autoincrement())
  patientId Int      @map("patient_id")
  name      String   @db.VarChar(80)
  slot      Int?     @db.SmallInt
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at")
  patient   Patient  @relation(fields: [patientId], references: [id], onDelete: Cascade)
  @@index([patientId])
  @@map("medicines")
}
```
- Integer `id` PKs (the device needs small stable ints). Plural snake_case tables and columns via `@@map` / `@map`; camelCase in code.
- Every FK has an explicit `onDelete`. Deleting a `Patient` (or `User`, `Device`) cascades through everything under it; the tests rely on that to empty the database.
- Status-like columns are `VarChar` + validation in zod/services (no MySQL enums, no CHECK constraints: Prisma cannot model them).
- **MySQL has no partial indexes.** "One active medicine per slot per VOICE" is enforced in `medicineService.checkSlot` and `patientService.pairDevice`, not by the database.
- `Json` columns have no DB default: always set them in code (`slotState: {}`, `daysOfWeek`, `notifyPrefs`, `data`, `result`, `timings`).

## Time
- **Every instant is `DateTime` in UTC** (`utcnow()`). Pass `createdAt: new Date()` explicitly where the value matters to logic or tests (the client-side default would not follow a frozen clock).
- **Wall-clock schedule times** are `@db.Time(0)` and mean `DEVICE_TZ` (Asia/Manila). Prisma returns `1970-01-01THH:MM:SSZ`; convert with `fromDbTime` / `dbTime` in `src/core/timeutil.ts`.
- **Calendar dates** (`intake_records.dose_date`, `medicines.expiry_date`) are `@db.Date`; use `fromDbDate` / `dbDate` ('YYYY-MM-DD' strings in services).
- **Device event times** arrive as naive PH local time. Store `local_time` (the wall clock held as if UTC; part of the idempotency key) and `occurred_at` (the real UTC instant from `localToUtc`).
- Never convert local time to UTC with a fixed `+8` in application code except in tests (`ph()` helper); production code uses `DEVICE_TZ` through `Intl`.

## Tables
`users, refresh_tokens, push_tokens, patients, patient_caregivers, invites, devices, medicines, schedules, reference_images, device_events, intake_records, alerts, scans`. ER diagram in `docs/architecture.md`. Patients point at their VOICE (`patients.device_id`); several patients can share one device.

## Key indexes and constraints
- `device_events`: unique `(device_id, type, dose_id, local_time)` (`uq_device_events_idem`), `dose_id` NOT NULL default 0.
- `intake_records`: unique `(schedule_id, dose_date)`; index `(patient_id, dose_date)`.
- `alerts`: unique `(user_id, dedup_key)`; index `(user_id, created_at)`.
- `scans`: index `(patient_id, created_at)` and `(created_at)` for cleanup.
- `devices.device_id`, `devices.camera_id`, `users.email`, `invites.code`, `push_tokens.token`: unique.

## Migrations
1. Edit `prisma/schema.prisma`.
2. `make revision m="add thing"` (runs `prisma migrate dev --name` in the api container as MySQL root so it can create the shadow database).
3. **Review `prisma/migrations/<timestamp>_<name>/migration.sql`**: renames come out as drop+create (rewrite them as `RENAME`), and data backfills must be added by hand.
4. `make migrate` (also run by the api container at start via `prisma migrate deploy`), `make test`, then commit the migration with the schema change.
- Never edit a committed migration; add a new one.

## Queries
- In repositories only (`src/repositories/*.ts`), each function takes an optional `db: Db = prisma` so it can run inside a transaction.
- Idempotent inserts: `create` + catch `isUniqueViolation` (Prisma `P2002`) → "already there". Used for events, alerts and intake rows.
- Counters that concurrent requests can hit use one SQL statement (`decrementQty`: `GREATEST(qty - dose_amount, 0)`), and state flips use `updateMany({ where: { id, status: ... } })` and check `count`.
- No `SELECT ... FOR UPDATE` helpers: the conditional-update pattern above replaced them.

## Seed data (`make seed`, `make reset-seed`, or `SEED_DEMO=true` at start)
`prisma/seed.ts`, idempotent (does nothing if `demo@example.com` exists; `--reset` removes the demo data first): caregiver demo@example.com / demo1234, patient "Lola Rosa", device `pillbox` + `pillbox-cam`, and
| slot | medicine | state | doses |
|---|---|---|---|
| 1 | Losartan 50mg | ok, qty 24 | 08:00 |
| 2 | Metformin 500mg | **low** (qty 4, threshold 6) | 08:00, 20:00 |
| 3 | Amlodipine 5mg | **expired** (2026-09-30) | 13:00 |
Plus the reference photos from `seed_assets/` and three days of intake history.

## Tests
They use the real MySQL database `medrem_test` (created by `db/init-test-db.sh`). Migrations are applied once (`tests/global-setup.ts`); before each test `DELETE FROM users/patients/devices` cascades everything away. The setup **refuses to run** if `DATABASE_URL` does not end in `_test`.
