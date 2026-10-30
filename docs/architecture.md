# Architecture

## Overview

```mermaid
flowchart LR
  subgraph Home["Home WiFi (2.4 GHz LAN)"]
    PB["Main ESP32<br/>pillbox: 5 slots, screen, speaker"]
    CAM["ESP32-CAM<br/>pillbox-cam"]
    PHONE["Caregiver phone<br/>Expo app"]
  end
  subgraph PC["PC / server: Docker Compose"]
    API["api (FastAPI :5000)<br/>device paths + /api/v1 + WebSocket<br/>vision models loaded"]
    WK["worker<br/>APScheduler jobs + Expo push"]
    DB[("PostgreSQL 16<br/>+ pgvector")]
    RD[("Redis<br/>pub/sub, push queue, locks, rate limits")]
    VOL[("scans volume<br/>scan + reference images")]
    EXPO["mobile (Expo dev server :8081)<br/>dev only"]
    CADDY["caddy :443<br/>prod only"]
  end
  PB -- "GET /api/schedule every 60 s<br/>POST /api/events" --> API
  CAM -- "POST /api/scan (JPEG)" --> API
  PHONE -- "HTTPS/HTTP /api/v1 + WS" --> API
  PHONE -. "bundle (dev)" .-> EXPO
  CADDY --> API
  API --> DB
  API --> RD
  API --> VOL
  WK --> DB
  WK --> RD
  RD -- "patient:* channels" --> API
  WK -- "push" --> EXPOPUSH["Expo push service"]
  EXPOPUSH --> PHONE
```

- **One FastAPI app** serves the frozen ESP32 contract (`/api/schedule`, `/api/scan`, `/api/events`) and the caregiver API (`/api/v1/...`) on port 5000 (D2).
- **The worker** is the same image with `python -m app.worker`. It runs timed rules and sends Expo push from the Redis queue `push:queue` (D7).
- **Realtime:** services publish small hints (`{type, patientId}`) to Redis after each commit. The `/api/v1/ws` hub forwards them to each caregiver's sockets, and the app refetches the matching queries.

## Code layout and layering

See `.claude/skills/architecture/SKILL.md`. Backend: `api → services → repositories → models`; `core` is used by all; `jobs` and `api` are the only entry points into services. App: `src/app` routes → `src/features` → `src/api` hooks → `src/lib`. `src/components` is the design system.

## Main flows

### Dose reminder (device side)

```mermaid
sequenceDiagram
  participant PB as Pillbox
  participant API
  participant DB
  participant R as Redis
  participant App
  PB->>API: GET /api/schedule?device=pillbox (every 60 s)
  API->>DB: today's active, slotted doses (PH date)
  API-->>PB: {doses:[{id, slot, name, dose, time, ...}]}
  Note over PB: 08:00 alarm + voice
  PB->>API: POST /api/events {type: due}
  API->>DB: intake_record(status=due, due_at)
  PB->>API: POST /api/events {type: taken}
  API->>DB: status=taken, delay, qty -= dose (row lock)
  API->>R: PUBLISH patient:1 intake.updated
  R-->>App: WebSocket hint → refetch Today
```

`missed` works the same way. It also inserts one alert per caregiver (deduplicated) and `LPUSH`es the alert ids, which the worker sends through Expo push. If the device never reports, the worker's `reconcile_missed` job marks the dose missed 35 minutes after its time (D8).

### Scan

`POST /api/scan` checks the size, type, and device; saves the JPEG; then runs the pipeline with an 8.5 s budget: **barcode → OCR → CLIP embedding (pgvector) → optional Claude**. It stops at the first confident match. The answer is `{found:false}` or the medicine with `low`/`expired` flags. An unknown scan raises a `scan_unknown` alert. A caregiver correction adds the photo as a new reference image. Details: `.claude/skills/medicine-vision/SKILL.md`.

## Data model

```mermaid
erDiagram
  users ||--o{ patient_caregivers : "looks after"
  patients ||--o{ patient_caregivers : ""
  patients ||--o| devices : "pillbox + camera"
  patients ||--o{ medicines : ""
  medicines ||--o{ schedules : "dose times (id = device dose id)"
  medicines ||--o{ reference_images : "embedding vector(512)"
  patients ||--o{ intake_records : "one per schedule per day"
  patients ||--o{ device_events : "raw, idempotent"
  patients ||--o{ scans : "30-day retention"
  users ||--o{ alerts : "inbox, dedup per user"
  users ||--o{ push_tokens : ""
  users ||--o{ refresh_tokens : "rotation"
  patients ||--o{ invites : "6-char codes"
```

Key constraints: `device_events (device_id, type, dose_id, local_time)` unique (idempotency), `intake_records (schedule_id, dose_date)` unique, `alerts (user_id, dedup_key)` unique, `medicines (patient_id, slot)` unique where active, and an HNSW cosine index on `reference_images.embedding`.

## Time

All instants are UTC `timestamptz`. Schedule times are wall-clock `time` in `DEVICE_TZ` (Asia/Manila), because the firmware clock is fixed at UTC+8. Device event times arrive naive and are stored both as `local_time` and as UTC `occurred_at` (D5).

## Security model (summary)

Caregivers use JWT access tokens (15 min) and rotating refresh tokens (30 days, with reuse detection); passwords are hashed with argon2id. Devices have no auth (the firmware is fixed). They are accepted only when paired, are rate-limited, and only see their own patient's data. Port 5000 must stay on the LAN; prod exposes only `/api/v1` and `/healthz` through Caddy. Details: `.claude/skills/security-privacy/SKILL.md`.
