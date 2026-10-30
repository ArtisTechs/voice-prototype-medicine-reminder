---
name: security-privacy
description: Use when touching authentication (JWT access/refresh, argon2), device identification and pairing, input validation, secrets, CORS, logging, rate limits, or anything that stores, shows, sends, or deletes health data. Includes the security review checklist.
---

# Security and privacy rules

## Caregiver auth
- **Passwords:** `argon2-cffi` `PasswordHasher()` (argon2id defaults). Re-hash on login when `check_needs_rehash`. Minimum 8 characters, maximum 128.
- **Access token:** JWT HS256 (`JWT_SECRET` ≥ 32 bytes, from env), 15 min, claims `sub` (user id), `type:"access"`, `exp`, `iat`, `jti`.
- **Refresh token:** JWT, 30 days, `type:"refresh"`, and its `jti` stored in `refresh_tokens`. Each `/auth/refresh` **rotates** (revokes the old jti, issues a new one). Reusing a revoked jti revokes all of that user's refresh tokens (theft signal).
- Sign out revokes the presented refresh token and deletes the push token. Deleting the account revokes everything.
- Login and signup are rate-limited at 10/min per IP. Errors are generic (`invalid_credentials`).
- The WebSocket authenticates with the access token in the query string (RN cannot set WS headers reliably). Never log the query string.

## Authorization
- Every patient-scoped query goes through `require_patient(db, user, patient_id)` (a `patient_caregivers` link). If it fails → **404**.
- Child resources (medicine, schedule, scan, alert) are loaded **joined to the patient link**, never by id alone.
- Only an `owner` can delete a patient or remove caregivers. Members can do everything else.

## Devices (no auth in firmware)
- The device endpoints are unauthenticated by necessity. Their mitigations:
  - Accept only `device_id`/`camera_id` values a caregiver has paired. Others → 403 (D6).
  - Rate limits per device id (schedule 30/min, events 120/min, scan 6/min) + a body size cap (scan 4 MB, events 4 KB).
  - Devices can only write events and scans for their own patient, and read only that patient's schedule.
  - The schedule response holds only what the screen needs (no patient name).
- The risk is accepted for the LAN prototype and recorded in `docs/decisions.md`. Do not expose port 5000 to the internet; prod Caddy serves only `/api/v1`, `/healthz` over HTTPS.

## Input validation
- Every body is a Pydantic model with lengths and ranges. Query params are typed. Upload content type and magic bytes are checked (JPEG `FF D8 FF`, PNG). Images are re-encoded with Pillow before being stored as references (strips EXIF/GPS).
- File paths are generated (uuid), never taken from the user.
- SQL is only through SQLAlchemy expressions. No f-string SQL.

## Secrets
- No secrets in git: `.env` is ignored and `.env.example` has placeholders. `JWT_SECRET`, `POSTGRES_PASSWORD`, `ANTHROPIC_API_KEY`, `EXPO_ACCESS_TOKEN` come only from env.
- The app gets only `EXPO_PUBLIC_*` values, which are public by definition. Never put a secret there.
- The api refuses to start in prod (`ENV=prod`) if `JWT_SECRET` is the example value or shorter than 32.

## CORS
`CORS_ORIGINS` is a comma list. Dev default: `http://localhost:8081,http://localhost:19006`. Native apps do not need CORS. Never use `*` with credentials.

## Health data privacy
- **Minimum data:** a patient is a display name + an optional note, with no birth date, ID numbers, or address. Medicines and intake records are the data that is needed.
- **Logs:** ids, counts, timings, and status codes only. Never emails, names, medicine names, OCR text, tokens, or image bytes. `core/logging.py` has a `redact()` filter for keys like `password, token, email, name`.
- **Claude fallback:** it is off by default. When on, it sends only the image + the list of `id: medicine name strength`, and never patient info. This is documented in Settings/privacy text.
- **Retention:** scan images 30 days; device events 180 days; alerts 90 days (cleanup job).
- **Delete on request:** `DELETE /api/v1/me` deletes the user, their tokens and alerts, and every patient where they were the last caregiver (cascade: medicines, schedules, events, intakes, scans **and image files**, devices unpaired). Test it.
- **Push bodies** are short ("Lola Rosa missed a dose at 8:00 AM"), because lock screens are visible to others. A setting can hide medicine names.

## Security review checklist (Milestone 7, and any auth/device change)
- [ ] No route without auth except: `/healthz`, `/api/v1/auth/*`, device paths
- [ ] Every patient-scoped route uses `require_patient`; there is a cross-tenant test returning 404
- [ ] Refresh rotation + reuse detection tested
- [ ] Rate limits on login, signup, device endpoints
- [ ] Uploads: size, type, magic bytes, re-encode
- [ ] `grep` logs for emails/names in a `make sim` run → none
- [ ] `.env` not tracked; `git log -p | grep -i secret` is clean
- [ ] `DELETE /me` removes files on disk
- [ ] Containers run as non-root; prod has no adminer, docs, or reload
