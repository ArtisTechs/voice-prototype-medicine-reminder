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
    API["api (Express :5055)<br/>device paths + /api/v1 + WebSocket<br/>scan pipeline"]
    WK["worker<br/>node-cron jobs + Expo push"]
    DB[("MySQL 8.4")]
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
  API -- "scan photo + medicine list (HTTPS)" --> GEMINI["Google Gemini API<br/>free tier"]
  WK -- "push" --> EXPOPUSH["Expo push service"]
  EXPOPUSH --> PHONE
```

- **One Express app** serves the frozen ESP32 contract (`/api/schedule`, `/api/scan`, `/api/events`) and the caregiver API (`/api/v1/...`) on port 5055 (D2, D23).
- **The worker** is the same image with `node dist/src/worker.js`. It runs timed rules and sends Expo push from the Redis queue `push:queue` (D7).
- **Realtime:** services publish small hints (`{type, patientId}`) to Redis after each commit. The `/api/v1/ws` hub forwards them to each caregiver's sockets, and the app refetches the matching queries.

## Code layout and layering

See `.claude/skills/architecture/SKILL.md`. Backend: `routes → services → repositories → Prisma`; `core` is used by all; `jobs` and `routes` are the only entry points into services. App: `src/app` routes → `src/features` → `src/api` hooks → `src/lib`. `src/components` is the design system.

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
  API->>DB: status=taken (conditional update), delay, qty = max(qty - dose, 0)
  API->>R: PUBLISH patient:1 intake.updated
  R-->>App: WebSocket hint → refetch Today
```

`missed` works the same way. It also inserts one alert per caregiver (deduplicated) and `LPUSH`es the alert ids, which the worker sends through Expo push. If the device never reports, the worker's `reconcile_missed` job marks the dose missed 35 minutes after its time (D8).

### Scan

`POST /api/scan` checks the device, type and size (2 MB); saves the JPEG; then asks **Gemini** (one call, 8 s abort) which of this box's registered medicines is on the package, with a JSON-only answer `{medicineId|null, readName, readStrength, readExpiry, confidence}`. **Code** decides: the id must belong to this box and the confidence must be at least 0.7 (otherwise a fuzzy match on the name it read). The answer to the camera is read from MySQL, never from the model. Any failure answers `{"found":false}` inside the 10 s limit. An unknown scan raises a `scan_unknown` alert. A caregiver correction adds the photo as a new reference photo. Details: `.claude/skills/medicine-vision/SKILL.md`.

## Data model

```mermaid
erDiagram
  users ||--o{ patient_caregivers : "looks after"
  patients ||--o{ patient_caregivers : ""
  devices ||--o{ patients : "one VOICE, several people"
  patients ||--o{ medicines : ""
  medicines ||--o{ schedules : "dose times (id = device dose id)"
  medicines ||--o{ reference_images : "photos of the package"
  patients ||--o{ intake_records : "one per schedule per day"
  patients ||--o{ device_events : "raw, idempotent"
  patients ||--o{ scans : "30-day retention"
  users ||--o{ alerts : "inbox, dedup per user"
  users ||--o{ push_tokens : ""
  users ||--o{ refresh_tokens : "rotation"
  patients ||--o{ invites : "6-char codes"
```

Key constraints: `device_events (device_id, type, dose_id, local_time)` unique (idempotency), `intake_records (schedule_id, dose_date)` unique, `alerts (user_id, dedup_key)` unique. "One active medicine per slot per VOICE" is checked in the services (MySQL has no partial indexes, D24).

## Time

All instants are UTC `DateTime`s. Schedule times are wall-clock `TIME` in `DEVICE_TZ` (Asia/Manila), because the firmware clock is fixed at UTC+8. Device event times arrive naive and are stored both as `local_time` and as UTC `occurred_at` (D5).

## Security model (summary)

Caregivers use JWT access tokens (15 min) and rotating refresh tokens (30 days, with reuse detection); passwords are hashed with argon2id. Devices have no auth (the firmware is fixed). They are accepted only when paired, are rate-limited, and only see their own patient's data. Port 5055 must stay on the LAN (or behind `DEVICE_PATH_SECRET`); prod exposes only `/api/v1` and `/healthz` through Caddy. Details: `.claude/skills/security-privacy/SKILL.md`.
