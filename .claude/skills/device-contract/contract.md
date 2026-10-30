# ESP32 contract: full reference

## Hardware recap
- **Main ESP32 (`pillbox`):** 5 slots with lid contact switches (open/closed only, no pill counts), a 320x240 touch screen, and a speaker with fixed voice clips.
  - Polls the schedule every **60 s**. At dose time it loops the alarm + voice until the slot lid opens (→ `taken`) or **30 min** pass (→ `missed`).
  - Buffers up to **8 events** while the backend is offline and resends them later. An event can arrive twice.
  - Its clock is **Philippine time (UTC+8)**, with no offset in the payloads.
  - The CAMERA button triggers the ESP32-CAM.
- **ESP32-CAM (`pillbox-cam`):** takes a 1024x768 JPEG of the medicine package and POSTs it. It gives up after **15 s**. It forwards the JSON to the main board, which says "identified", "not found", "expired" or "running low".

## GET /api/schedule?device=pillbox
200:
```json
{ "doses": [
  { "id": 12, "slot": 1, "name": "Losartan 50mg", "dose": "1 tablet",
    "time": "08:00", "instructions": "After breakfast", "expiry": "2027-06-30", "qty": 24 }
] }
```
| field | type | source | limit |
|---|---|---|---|
| id | int | `schedules.id` | stable |
| slot | int 1–5 | `medicines.slot` | medicines without a slot are skipped |
| name | str | `name + " " + strength` | 23 |
| dose | str | `"{dose_amount} {unit}"` (`tablet`/`tablets`, unit from `dose_unit` or form) | 15 |
| time | "HH:MM" | `schedules.time` | 5 |
| instructions | str | `medicines.instructions` or `""` | 39 |
| expiry | "YYYY-MM-DD" or "" | `medicines.expiry_date` | 10 |
| qty | int | `medicines.qty` | ≥0 |

At most 20 entries. Empty schedule → `{"doses": []}`.

## POST /api/scan
Request: body = raw JPEG bytes, `Content-Type: image/jpeg`, `X-Device: pillbox-cam`. Max body 4 MB (413 if bigger). A non-JPEG body → 415.

200 found:
```json
{ "found": true, "name": "Losartan 50mg", "dose": "1 tablet", "instructions": "After breakfast",
  "expiry": "2027-06-30", "slot": 1, "qty": 24, "low": false, "expired": false }
```
200 not found: `{ "found": false }` (exactly this, no other keys).

Limits: name 31, dose 19, instructions 63, expiry 10. `slot` = assigned slot or 0. `low` = `qty <= low_stock_threshold`. `expired` = `expiry_date < today(PH)`. `expiry` = `""` if unknown.

Timing: the full request must take under 10 s. Budget: read + save ≤ 0.3 s, pipeline ≤ 8.5 s, DB + response ≤ 0.5 s.

## POST /api/events
```json
{ "device": "pillbox", "type": "taken", "slot": 1, "doseId": 12, "time": "2026-10-30T08:04:10" }
```
| type | meaning | side effect |
|---|---|---|
| due | alarm started for doseId | intake record `due`, `due_at` = time |
| taken | lid opened for the due dose | intake `taken`, delay = time − scheduled time; qty −= dose amount (≥0); optional `taken` alert |
| missed | 30 min without the lid opening | intake `missed`; `missed` alert to all caregivers |
| expired | dose due but the medicine is expired | intake status `expired` (if no taken); `expired_dose` alert |
| opened | lid opened with no dose due | slot `lidOpen=true` |
| closed | lid closed | slot `lidOpen=false` |
| scan_ok / scan_expired / scan_unknown / scan_fail | camera outcome shown to the patient | store only |

- Idempotency key: `(device, type, coalesce(doseId,0), time)`, a unique index on `device_events`.
- `doseId` may be 0 or missing. `slot` may be missing (then it is taken from the dose's medicine).
- `time` is not trusted for the order of arrival. Each event is processed by its own `time`; a `taken` after a `missed` for the same dose upgrades it to `taken`.
- Response: 200 `{"ok": true}` (or `"duplicate": true`).
- An unknown `type` → stored and 200 (forward compatibility). A bad `time` format → 422.

## Errors (all three endpoints)
`{"error": {"code": "<snake>", "message": "<human>"}}` with 403 device_not_registered, 413 too_large, 415 unsupported_media_type, 422 validation_error, 429 rate_limited.
