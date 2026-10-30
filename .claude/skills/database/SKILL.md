---
name: database
description: Use when adding or changing tables, columns, indexes, queries, Alembic migrations, or seed data in services/api (PostgreSQL 16 + pgvector, SQLAlchemy 2 async). Also covers UTC timestamps and Philippine local time handling.
---

# Database conventions

## Stack
PostgreSQL 16 with pgvector (`pgvector/pgvector:pg16`), SQLAlchemy 2.0 async (`asyncpg`), Alembic, `pgvector.sqlalchemy.Vector`.

## Model conventions
```python
class Medicine(Base, TimestampMixin):
    __tablename__ = "medicines"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    slot: Mapped[int | None] = mapped_column(SmallInteger)
    __table_args__ = (
        CheckConstraint("slot between 1 and 5", name="slot_range"),
        Index("uq_medicine_patient_slot", "patient_id", "slot", unique=True,
              postgresql_where=text("slot is not null and active")),
    )
```
- Integer `id` PKs (the device needs small stable ints). Plural snake table names. FKs with explicit `ondelete`.
- `TimestampMixin`: `created_at`, `updated_at` as `DateTime(timezone=True)`, `server_default=func.now()`.
- Enums are `String(16)` + a `CheckConstraint`, not PG enum types (easier migrations).
- Use the `MetaData(naming_convention=...)` in `core/db.py` so constraint names are stable.
- `Mapped[...]` typing everywhere. Relationships `lazy="raise"`, so load explicitly with `selectinload`.

## Time
- **Every instant is `timestamptz` in UTC.** Use `app.core.timeutil.utcnow()`.
- **Wall-clock schedule times** are `Time` (no tz) and mean `DEVICE_TZ` local (Asia/Manila).
- **Device event times** arrive naive PH local. Store both `local_time` (naive `timestamp`, part of the idempotency key) and `occurred_at` (UTC, from `to_utc(local, DEVICE_TZ)`).
- **Calendar dates** of doses (`intake_records.dose_date`) are PH local `Date`.
- Never call `datetime.now()` without a tz. Never store local time in `timestamptz`.

## Tables (current)
`users, refresh_tokens, push_tokens, patients, patient_caregivers, invites, devices, medicines, schedules, reference_images(vector 512), device_events, intake_records, alerts, scans`. See `docs/architecture.md` for the ER diagram.

## Key indexes and constraints
- `device_events`: unique `(device_id, type, dose_id, local_time)` with `dose_id` NOT NULL default 0 (idempotency).
- `intake_records`: unique `(schedule_id, dose_date)`.
- `alerts`: unique `(user_id, dedup_key)`; index `(user_id, created_at desc)`.
- `reference_images.embedding`: `hnsw (embedding vector_cosine_ops)`.
- `scans`: index `(patient_id, created_at desc)`, `created_at` (cleanup).
- `devices.device_id`, `devices.camera_id`: unique.

## Migrations
1. Change the models.
2. `make revision m="add scans table"`. This runs `alembic revision --autogenerate` in the api container.
3. **Review the file:** autogenerate misses partial-index `where`, check constraints, `CREATE EXTENSION vector`, server defaults, and data backfills. Fix them by hand.
4. `make migrate`, then `make test`, then commit the migration together with the model change.
- Never edit a migration that is already committed. Add a new one.
- The api container runs `alembic upgrade head` at startup (`entrypoint.sh`).

## Queries
- In repositories only. Use `select()` 2.0 style, `scalars()`, and `selectinload`. Use `with_for_update()` when decrementing `qty`.
- Upsert/idempotent inserts: `insert(...).on_conflict_do_nothing(index_elements=[...]).returning(id)`. No returned row → duplicate.
- Vector search: `select(RefImg).order_by(RefImg.embedding.cosine_distance(vec)).limit(5)`, filtered by the patient's medicine ids.

## Seed data (`python -m app.seed`, `make seed`)
Idempotent (it does nothing if `demo@example.com` exists; `--reset` drops the demo data first). It creates: caregiver demo@example.com/demo1234, patient "Lola Rosa", device `pillbox` + `pillbox-cam`, medicines:
| slot | medicine | state | doses |
|---|---|---|---|
| 1 | Losartan 50mg | ok, qty 24 | 08:00 |
| 2 | Metformin 500mg | **low** (qty 4, threshold 6) | 08:00, 20:00 |
| 3 | Amlodipine 5mg | **expired** (2026-09-30) | 13:00 |
It also adds generated reference images from `app/seed_assets/` and three days of intake history.

## Tests
They use the real Postgres `medrem_test` database (created by `db/init.sql`). The schema is built once per session through Alembic `upgrade head`, and each test runs in a transaction that is rolled back.
