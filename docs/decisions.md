# Decisions

One entry per decision. Format: **context**, **choice**, **why**. Newest at the bottom.

## D1. No firmware or old mock in the repo
- **Context:** The repo started empty; `firmware/` and the old mock are not present.
- **Choice:** The device contract is taken from the written spec only. `tools/device-sim` is written from scratch. `firmware/` is left out until the sketches are added.
- **Why:** The spec is the only source we have, and the contract tests make it executable.

## D2. One FastAPI app serves both the device paths and `/api/v1`
- **Context:** The firmware needs host port 5000. The app also needs an API.
- **Choice:** A single `api` container on `0.0.0.0:5000` serves `/api/{schedule,scan,events}` (device), `/api/v1/*` (app), `/api/v1/ws` (WebSocket) and `/healthz`.
- **Why:** There is one port to open in the firewall and one process to run. In prod, Caddy adds HTTPS in front for the app only.

## D3. Dose id = schedule row id
- **Context:** The device keeps state per dose `id`, and that id must stay stable.
- **Choice:** Each `schedules` row is exactly one daily dose time of one medicine. Its integer primary key is the `id` sent to the device. Editing the time keeps the id; deleting the row retires it.
- **Why:** The id is stable by construction and needs no mapping table.

## D4. Device text is ASCII and neatly shortened
- **Context:** Firmware buffers are `char[]` limits. UTF-8 multibyte characters would overflow them or render as garbage.
- **Choice:** `core/text.py::fit()` transliterates to ASCII (NFKD, then drops non-ASCII), collapses spaces, cuts at a word boundary when that keeps at least 60% of the limit, otherwise hard-cuts, and strips trailing punctuation.
- **Why:** Byte length then equals character length, so the limit always holds.

## D5. Time handling
- **Context:** The device clock is Philippine time with no offset. The server stores UTC.
- **Choice:** All `timestamptz` columns are UTC. Device local times are interpreted in `DEVICE_TZ` (default `Asia/Manila`). Schedule times are stored as local `time` values (they are wall-clock times). "Today" for the device means today in `DEVICE_TZ`. Each caregiver has a display time zone setting (default `Asia/Manila`).
- **Why:** The firmware is fixed to UTC+8. Keeping wall-clock schedule times avoids DST-style drift.

## D6. Device registration and the camera
- **Context:** The firmware has fixed ids (`pillbox`, `pillbox-cam`) and no auth.
- **Choice:** A `devices` row has `device_id` (pillbox) and `camera_id` (default `<device_id>-cam`), both unique. Pairing in the app registers both. Unknown ids get `403 {"error":{"code":"device_not_registered"}}`.
- **Why:** The camera then maps to the same patient with no extra pairing step.

## D7. Missed alerts are written in the API; push is sent by the worker
- **Context:** The caregiver must be alerted "within seconds", and push is sent from the worker.
- **Choice:** Event ingestion creates the alert rows and publishes them over WebSocket right away. It then `LPUSH`es the alert ids to the Redis list `push:queue`. The worker `BRPOP`s that list and sends them through Expo push.
- **Why:** In-app alerts are instant, and the worker still owns push delivery.

## D8. Missed-dose fallback
- **Context:** If the pillbox is offline, no `missed` event arrives.
- **Choice:** A worker job marks a dose missed when it is more than 35 minutes past its time today with no intake record, and the schedule existed before that time. A later `taken` event still overrides `missed`.
- **Why:** Caregivers still hear about missed doses during outages. The extra 5 minutes leaves room for the device's own 30-minute window.

## D9. JSON casing
- **Choice:** `/api/v1` uses camelCase JSON (Pydantic `alias_generator=to_camel`). Device endpoints match the contract exactly.
- **Why:** The app is TypeScript, and the contract already uses `doseId`.

## D10. `make` on Windows
- **Context:** The development PC has no GNU make.
- **Choice:** The Makefile only wraps `docker compose` commands. `docs/setup.md` explains how to install make (`winget install ezwinports.make`) or run the same commands directly.
- **Why:** Nothing needs make beyond being a convenience.

## D11. Expo SDK 58 layout
- **Context:** The SDK 58 template keeps routes in `src/app/`. The skill first said `app/`.
- **Choice:** Routes are in `apps/mobile/src/app/`, and `package.json` `main` is `expo-router/entry`. The `mobile-expo` skill is updated to match.
- **Why:** This follows the current Expo default, so the docs and tooling line up.

## D12. Port clashes on the dev PC
- **Context:** Another local project already publishes host ports 5000/5001 and 8080.
- **Choice:** The API host port is `${API_PORT:-5000}` (the default stays 5000 for the firmware), and Adminer moved to `${ADMINER_PORT:-8089}`.
- **Why:** The firmware needs 5000, so the default never changes. The override only lets development run beside other stacks. Free port 5000 before connecting the real pillbox.

## D13. Scan answers for unpaired cameras
- **Context:** `X-Device` may be missing or unknown.
- **Choice:** 403 `device_not_registered`, the same as the other device endpoints. Any paired id (pillbox or camera) is accepted on `/api/scan`.
- **Why:** This keeps the rules consistent. The firmware shows a scan failure either way.
