---
name: notifications-jobs
description: Use when working on the worker container, APScheduler jobs, alert rules (missed, taken, low stock/refill, expiry, offline, unknown scan), Expo push sending, alert deduplication, notification preferences, or realtime WebSocket/Redis pub/sub updates to the app.
---

# Notifications, jobs, realtime

## Processes
- **api** creates alerts that come straight from device input (`missed`, `taken`, `expired_dose`, `scan_unknown`) inside the request, then publishes on Redis and queues push.
- **worker** (`python -m app.worker`) runs:
  1. `AsyncIOScheduler` with the timed jobs below (timezone `DEVICE_TZ`)
  2. the push consumer loop: `BRPOP push:queue` → Expo push
- Both use the same `services/alert_service.py`. All rules live there, never in jobs or routers.

## Alert model
`alerts(id, user_id, patient_id, type, severity, title, body, data jsonb, dedup_key, read_at, pushed_at, created_at)`, unique `(user_id, dedup_key)`.
`alert_service.raise_alert(db, patient_id, type, dedup_key, title, body, data)`:
1. Load the patient's caregivers. Skip those whose prefs turn this type off.
2. `INSERT ... ON CONFLICT (user_id, dedup_key) DO NOTHING RETURNING id`. Only new rows continue.
3. Commit. Then `publish(patient_id, "alert.created", {...})` and `LPUSH push:queue <alert_id>` for each new row.

## Rules and dedup keys
| type | trigger | where | dedup_key | default pref |
|---|---|---|---|---|
| `missed` | `missed` event, or the fallback job (D8) | api / job `reconcile_missed` (every 1 min) | `missed:{schedule_id}:{dose_date}` | on |
| `taken` | `taken` event | api | `taken:{schedule_id}:{dose_date}` | **off** |
| `low_stock` | `qty / daily_usage ≤ refill_lead_days` or `qty ≤ low_stock_threshold` | after a `taken` event + job `inventory` (daily 09:00 and every 6 h) | `refill:{medicine_id}:{dose_date}` (once a day) | on |
| `expiry` | days to expiry hits ≤30, ≤7, ≤0 | job `expiry` (daily 08:30 + at startup) | `expiry:{medicine_id}:{expiry_date}:{30|7|0}` | on |
| `expired_dose` | `expired` event (dose due while expired) | api | `expdose:{schedule_id}:{dose_date}` | on |
| `offline` | `devices.last_seen` > 10 min ago | job `offline` (every 1 min) | `offline:{device_id}:{last_seen epoch}` (once per outage) | on |
| `scan_unknown` | `/api/scan` → found false | api | `scan:{scan_id}` | on |

Severity: `missed, expired_dose, offline` = high; `low_stock, expiry, scan_unknown` = normal; `taken` = info.
**Copy** (plain): "Lola Rosa missed Losartan 50mg (8:00 AM)". "Pillbox is offline since 9:12 AM". "Metformin is running low: 4 left (2 days)".

## Jobs
- Each job is wrapped in `with_lock("lock:<job>", ttl)` (Redis `SET NX EX`), so two workers never double-run.
- The job opens its own session, catches and logs exceptions (the scheduler keeps going), and logs `job_done name=.. ms=.. created=..`.
- Jobs: `reconcile_missed` 1 min, `offline` 1 min, `inventory` cron 09:00 + interval 6 h, `expiry` cron 08:30, `cleanup_scans` cron 03:00 (delete scans and files > `SCAN_RETENTION_DAYS`, expired invites, revoked refresh tokens).
- `misfire_grace_time=60`, `coalesce=True`, `max_instances=1`.

## Expo push (`app/jobs/push.py`)
- `POST https://exp.host/--/api/v2/push/send`, batches ≤100, `Authorization: Bearer EXPO_ACCESS_TOKEN` if set, httpx timeout 10 s.
- The message is `{to, title, body, sound:"default", priority:"high", channelId:"alerts", data:{alertId, patientId, url}}`.
- A ticket `DeviceNotRegistered` deletes the push token. Other errors retry ×3 with backoff, then are logged and dropped. Set `pushed_at` on success.
- Respect `EXPO_PUSH_ENABLED=false` (tests/dev offline): log only.
- **No health details in the push body beyond what the inbox shows.** Never add extra fields.

## Realtime (`app/realtime/`)
- `publisher.publish(patient_id, type, data={})` → Redis `PUBLISH patient:{id} {"type", "patientId", "data", "ts"}`. Call it **after commit**.
- `ws.py`: `GET /api/v1/ws?token=<access JWT>`. Auth fails → close 4401. It subscribes to the channels of every patient the caregiver can see (and re-subscribes on `patients.changed`). It forwards messages, sends `{"type":"ping"}` every 25 s, and drops the connection when a send fails.
- **Message types:** `intake.updated`, `device.updated`, `alert.created`, `medicine.updated`, `scan.created`, `patients.changed` (user channel `user:{id}`).
- Messages are hints to refetch. They carry ids, not full records.

## Checklist for a new alert type
- [ ] Rule in `alert_service`, with a stable dedup key
- [ ] Pref flag in `users.notify_prefs` default + Settings screen toggle
- [ ] Unit test: fires once, does not fire twice, respects the pref
- [ ] Copy reviewed against **ui-ux** language rules
