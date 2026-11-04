# API reference

The interactive OpenAPI docs are at `http://localhost:5055/docs` (dev only, `ENABLE_DOCS=true`).

- **Errors** always use one shape: `{"error": {"code": "snake_case", "message": "Human text.", "details": null | [...]}}`. Validation errors are `422 validation_error` with `details: [{field, message}]`.
- **App JSON** is camelCase.
- **Auth** for the app endpoints is `Authorization: Bearer <accessToken>`.
- **Paging:** paged lists take `?limit&offset` and return `{items, total, limit, offset}`.

## Device API (ESP32, frozen; see `.claude/skills/device-contract/contract.md`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/schedule?device=pillbox` | `{doses:[{id,slot,name,dose,time,instructions,expiry,qty}]}`, at most 20, heartbeat |
| POST | `/api/scan` | raw JPEG, `X-Device: pillbox-cam` → full result, or `{"found": false}` (with `guess` and `guessed` when the AI read or recognised a name that is not a registered medicine), answered in under 10 s |
| POST | `/api/events` | `{device,type,slot,doseId,time}` → `{"ok":true}` (`"duplicate":true` on a resend) |

Errors: 403 `device_not_registered`, 413, 415, 422, 429 `rate_limited` (schedule 30/min, events 120/min, scan 6/min per device).

## App API (`/api/v1`)

| Area | Endpoints |
|---|---|
| Public | `GET /meta`, `GET /healthz` |
| Auth | `POST /auth/signup {email,password,name}` → tokens · `POST /auth/login` · `POST /auth/refresh {refreshToken}` (rotates) · `POST /auth/logout {refreshToken?, pushToken?}` |
| Me | `GET /me` · `PATCH /me {name?, timezone?, notifyPrefs?}` · `DELETE /me` (account + orphaned patients + files) · `POST /me/push-tokens {token, platform}` |
| Patients | `GET/POST /patients` · `GET/PATCH/DELETE /patients/{id}` (delete: owner only) · `POST /patients/{id}/leave` · `GET /patients/{id}/caregivers` |
| Sharing | `POST /patients/{id}/invites` → `{code, expiresAt}` · `POST /invites/accept {code}` |
| Pillbox | `GET/PUT/DELETE /patients/{id}/device` (PUT `{deviceId, cameraId?}`) → status, lastSeen, slots |
| Medicines | `GET/POST /patients/{id}/medicines` · `GET/PATCH/DELETE /patients/{id}/medicines/{mid}` (delete = deactivate) |
| Read a box photo | `POST /patients/{id}/medicines/read-package` (multipart `file`, JPEG/PNG) → `{read, name, strength, expiry, guessed, reason}`. Same AI reader as the VOICE scan; `guessed:true` means the name is a guess from how the box looks (it could not be read). The photo is not stored. Always 200 for a photo it could not read (`read:false`). |
| Dose times | `POST /patients/{id}/medicines/{mid}/schedules {time:"HH:MM", daysOfWeek:[0..6]}` · `PATCH/DELETE …/schedules/{sid}` |
| Photos | `GET/POST /patients/{id}/medicines/{mid}/photos` (multipart `file`, `angle`=front/back/side) · `GET …/photos/{pid}/image` · `DELETE …/photos/{pid}` |
| Today | `GET /patients/{id}/today` → `{date, doses:[{scheduleId,…,status,takenAt,delayMinutes}], summary}` |
| History | `GET /patients/{id}/history?from=YYYY-MM-DD&to=YYYY-MM-DD` (≤ 92 days) → overall, days, medicines, records |
| Dashboard | `GET /dashboard` → `{patients:[card], unreadAlerts}` |
| Alerts | `GET /alerts?limit&offset&unread&patientId` · `POST /alerts/{id}/read` · `POST /alerts/read-all` |
| Scans | `GET /patients/{id}/scans` · `GET …/scans/{sid}/image` · `POST …/scans/{sid}/correct {medicineId|null}`. `method` is `llm` (Gemini picked the medicine), `ocr` (matched on the name it read) or `none`; `score` is Gemini's confidence; `ocrExpiry` is the expiry date it read (information only); `readName` / `readStrength` are the name and strength printed on the box. `POST …/scans/learn` (204) makes the next scan from this person's VOICE count as "add a medicine": it is read even when the box has no medicines yet, no unknown-package alert is raised, and the answer to the box stays `{"found":false}`. |
| Pairing | `GET /devices/nearby` → unpaired boxes polling now, boxes checking in now, and boxes your people use |
| Realtime | `WS /ws?token=<accessToken>` (bad token → close 4401). Messages: `{type, patientId?, data, ts}` with type in `intake.updated, device.updated, medicine.updated, patient.updated, alert.created, alert.read, scan.created, patients.changed, ping` |

Dose status values: `upcoming, due, taken, late (> 15 min), missed, expired`. Alert types: `missed, taken, low_stock, expiry, expired_dose, offline, scan_unknown`.
