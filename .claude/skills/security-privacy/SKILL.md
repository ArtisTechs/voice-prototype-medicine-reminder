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
  - Rate limits per device id (schedule 30/min, events 120/min, scan 6/min) + a body size cap (scan 2 MB, events 16 KB).
  - Devices can only write events and scans for their own patient, and read only that patient's schedule.
  - The schedule response holds only what the screen needs (no patient name).
- The risk is accepted for the LAN prototype and recorded in `docs/decisions.md`. Do not expose port 5055 to the internet without `DEVICE_PATH_SECRET`; prod Caddy serves only `/api/v1`, `/healthz` over HTTPS.

## Input validation
- Every body and query is parsed by a zod schema with lengths and ranges (`route()` does it, so a route cannot skip it). Upload content type and magic bytes are checked (JPEG `FF D8 FF`, PNG). Reference photos are re-encoded with `sharp` before being stored (strips EXIF/GPS).
- File paths are generated (uuid), never taken from the user.
- SQL is only through Prisma. The two raw statements (`decrementQty`, the test cleanup) use tagged templates / constants, never string-built input.

## Secrets
- No secrets in git: `.env` is ignored and `.env.example` has placeholders. `JWT_SECRET`, `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `GEMINI_API_KEY`, `EXPO_ACCESS_TOKEN` come only from env.
- The app gets only `EXPO_PUBLIC_*` values, which are public by definition. Never put a secret there.
- The api refuses to start in prod (`ENV=prod`) if `JWT_SECRET` is the example value or shorter than 32.

## CORS
`CORS_ORIGINS` is a comma list. Dev default: `http://localhost:8081,http://localhost:19006`. Native apps do not need CORS. Never use `*` with credentials.

## Health data privacy
- **Minimum data:** a patient is a display name + an optional note, with no birth date, ID numbers, or address. Medicines and intake records are the data that is needed.
- **Logs:** ids, counts, timings, and status codes only. Never emails, names, medicine names, text read from a package, tokens, or image bytes. `core/logger.ts` redacts for keys like `password, token, email, name`.
- **Gemini (free tier):** scans send the package photo + the list of `id, name, strength, barcode` of that box's medicines to Google, never patient names or other personal data. Google may use free-tier inputs to improve its products; the one-line notice is in the app's Settings → Privacy and in `docs/setup.md`. The API key is server-side only.
- **Retention:** scan images 30 days; device events 180 days; alerts 90 days (cleanup job).
- **Delete on request:** `DELETE /api/v1/me` deletes the user, their tokens and alerts, and every patient where they were the last caregiver (cascade: medicines, schedules, events, intakes, scans **and image files**, devices unpaired). Test it.
- **Push bodies** are short ("Lola Rosa missed a dose at 8:00 AM"), because lock screens are visible to others. A setting can hide medicine names.

## Security review checklist (Milestone 7, and any auth/device change)
- [ ] No route without auth except: `/healthz`, `/api/v1/auth/*`, device paths
- [ ] Every patient-scoped route uses `route()` with `:patientId` (it checks the link); the cross-tenant test returns 404; `tests/api/security.test.ts` checks the route registry
- [ ] Refresh rotation + reuse detection tested
- [ ] Rate limits on login, signup, device endpoints
- [ ] Uploads: size, type, magic bytes, re-encode (photos), 2 MB cap (scan)
- [ ] `grep` logs for emails/names in a `make sim` run → none
- [ ] `.env` not tracked; `git log -p | grep -i secret` is clean
- [ ] `DELETE /me` removes files on disk
- [ ] Containers run as non-root; prod has no adminer, docs, or reload
