---
name: device-contract
description: Use whenever touching the ESP32-facing endpoints (GET /api/schedule, POST /api/scan, POST /api/events), their services, the device simulator, or the contract tests. The contract is fixed by firmware and must never change. Load before editing anything under services/api/src/routes/device/ or tools/device-sim/.
---

# Device contract (FROZEN)

**This contract must never change unless the firmware changes too.** The firmware cannot be changed for this project. Every change to these endpoints or their services must keep `tests/contract/` green (`make test-contract`). Full reference with examples: [contract.md](contract.md).

## Transport
- Plain HTTP on **host port 5055**, paths exactly `/api/schedule`, `/api/scan`, `/api/events` (no `/v1`, no trailing slash).
- No auth headers. Identity = `?device=` / JSON `device` / `X-Device` header.
- The firmware's `BACKEND_URL` is `http://<PC LAN IP>:5055`. Changing only that value must be enough.
- On an internet-facing server, `DEVICE_PATH_SECRET` is set and `BACKEND_URL` becomes `http://<host>:5055/d/<secret>`. `src/core/deviceSecret.ts` strips the prefix before routing (and before logging) and 404s the bare device paths. The contract itself (paths after the prefix, bodies, responses) is unchanged.

## Endpoints at a glance
| Endpoint | Identity | Success | Limits |
|---|---|---|---|
| `GET /api/schedule?device=pillbox` | query `device` | 200 `{"doses":[...]}` | ≤20 doses; name 23, dose 15, instructions 39, expiry 10 |
| `POST /api/scan` (raw `image/jpeg`, ≤ 2 MB) | header `X-Device: pillbox-cam` | 200 full object or `{"found":false}` | **answer < 10 s**; name 31, dose 19, instructions 63 |
| `POST /api/events` (JSON) | body `device` | any 2xx (we send 200 `{"ok":true}`) | idempotent on `(device,type,doseId,time)` |

## Rules
1. **Field names and types are exact:** `id` int, `slot` int 1–5 (scan: 0 = none), `time` `"HH:MM"` 24 h PH local, `expiry` `"YYYY-MM-DD"` (empty string `""` if unknown), `qty` int ≥ 0, `found/low/expired` bool. Never add `null`s. Extra fields are not allowed in schedule/scan responses.
2. **Text limits:** shorten with `fit(value, limit)` from `src/core/text.ts` only. It makes ASCII, cuts at a word boundary, and never exceeds the limit (D4).
3. **`id` stability:** dose `id` = `schedules.id` (D3). Never renumber, never derive from position.
4. **One entry per dose time.** Today's active doses only (PH date, days-of-week). Sorted by `time`, then `slot`. Truncate to 20.
5. **Heartbeat:** every schedule call (and every event/scan) updates `devices.last_seen` and publishes `device.updated`.
6. **Unknown or unpaired device** → `403 {"error":{"code":"device_not_registered","message":...}}`. Missing `device` → 422.
7. **Rate limits** (per device id, Redis fixed window, fail-open): schedule 30/min, events 120/min, scan 6/min → 429.
8. **Scan time budget:** the Gemini call is aborted at `GEMINI_TIMEOUT_MS` (8 s) and the whole pipeline is capped at `SCAN_BUDGET_SECONDS` (9). Anything not done by then returns `{"found":false}`. Never let the request exceed 10 s, and never answer a scan with a 5xx. The scan answer is built from the medicine's database row; nothing the model read goes to the device.
9. **Events:** `time` is naive PH local (`2026-10-30T08:04:10`). Accept a missing `doseId`, `0`, a missing `slot`, and unknown future types (store, 200, no side effect). Duplicates return 200 with `{"ok":true,"duplicate":true}`.
10. **Side effects:** `taken` → `qty -= doseAmount` (floor 0) + intake taken. `missed` → intake missed + alert. `due` → intake due (delay clock). `expired` → expired-dose alert. `opened/closed` → slot state. `scan_*` → stored only (the alert for unknown scans comes from `/api/scan` itself).
11. **Saving scans:** every scan image is saved to `SCAN_DIR/scans/<yyyy>/<mm>/<uuid>.jpg` with a `scans` row, deleted after 30 days.

## Checklist for any change here
- [ ] Response JSON keys and types unchanged (`tests/contract/*.test.ts` snapshot-style asserts).
- [ ] Limit tests: the longest allowed value passes, one character more is shortened, and multibyte input turns into ASCII.
- [ ] Every event type has a test, including the duplicate resend.
- [ ] `tools/device-sim` still runs a full day (`make sim`).
- [ ] No new required header, query param or auth.
