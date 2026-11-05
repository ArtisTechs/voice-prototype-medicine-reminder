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

## D14. Adherence and "expired" doses
- **Context:** The spec defines adherence as taken ÷ (taken + missed). The device can also report `expired` doses.
- **Choice:** Adherence = (on time + late) ÷ (on time + late + missed + expired). Expired doses count as not taken. Days with no data show `null` ("–" in the app).
- **Why:** An expired dose was not taken correctly, so leaving it out would overstate adherence.

## D15. Today status before the device reports
- **Context:** The timeline must be live even if an event is late or missing.
- **Choice:** Without an intake record, a dose is `upcoming` before its time, `due` for up to 35 minutes after it, and then `missed`. An expired medicine shows `expired` instead of upcoming/due. A record always wins.
- **Why:** It matches the device's 30-minute window plus the fallback job (D8).

## D16. WebSocket authorization scope
- **Choice:** The socket subscribes to the caregiver's patient channels when it connects, and again on `patients.changed`. A caregiver removed from a patient stops getting hints after reconnecting (at most until the next app restart or token refresh).
- **Why:** The messages only carry ids (no health data), and every refetch is still authorized by the REST API.

## D17. Expo dev server in Docker on Windows: sync instead of bind-mount watching
- **Context:** Docker Desktop delivers no inotify events for Windows-path bind mounts, even for writes made inside the container. Metro never saw edits.
- **Choice:** `apps/mobile` is mounted read-only at `/host`. `scripts/poll-sync.js` copies it into the container's own `/app` and polls mtimes every second, so Metro watches a normal Linux filesystem. `make test-mobile` runs the sync once before Jest.
- **Why:** Hot reload works with no WSL setup and no change to Metro, and it also works on macOS/Linux.

## D18. Expo Go is the default client
- **Context:** Installing `expo-dev-client` makes `expo start` default to development-build mode, and the QR code then does not open in Expo Go.
- **Choice:** The start script passes `--go` unless `EXPO_CLIENT=dev-client`.
- **Why:** The spec requires Expo Go to work for everything except remote push.

## D19. Vision thresholds and eval samples
- **Context:** On the synthetic set, correct embedding matches score 0.92–0.96 and unregistered boxes at most 0.65. Blank boxes with no print score about 0.43 against everything.
- **Choice:** Thresholds stay as specified (OCR ≥ 80 with an 8-point margin; embedding ≥ 0.85 with a 0.03 margin). The eval set uses "blurry" photos instead of blank boxes. A plain box that can only be told apart by color is correctly "not found".
- **Why:** A wrong "identified" is worse than "not found". Eval: 14 samples, 85.7% accuracy, 0 wrong medicines, p50 0.66 s, max 1.8 s (budget 8.5 s). Add real camera photos to `tests/vision_samples/` for real numbers.

## D20. Claude fallback request shape [superseded by D25: removed]
- **Choice:** `AsyncAnthropic` with `max_retries=0` and the timeout set to the time left in the scan budget. Model `claude-sonnet-5-5` with `effort: low`, structured output (a JSON schema `enum` of candidate ids + `"none"`), and server-side refusal fallback (`fallbacks: "default"`). Every error or refusal counts as "none".
- **Why:** The answer has to fit the 10 s camera limit, and the schema makes it impossible to name a medicine outside the patient's list.

## D21. Milestone 7 review results
- **UI/UX checklist:** run on every screen. Every data screen has a skeleton, an empty state, and an error state with retry. Every color pair passes WCAG AA in both themes (`__tests__/contrast.test.ts`, 36 checks). Every status shows icon + word. Touch targets are at least 48 dp. Form helper text moved from 14 pt to body size and tab labels to 16 pt. Font scaling is never disabled, and layouts wrap instead of clipping.
- **Security checklist:** a test proves every `/api/v1` route needs a caregiver except an explicit public list, and every `/patients/{id}` route checks the link (404). A grep of the logs after a full `make sim` found no emails, names, medicine names, or tokens. `.env` is untracked. Containers run as non-root. Prod has no Adminer, docs, or reload, and Caddy exposes only `/api/v1` + `/healthz`.

## VOICE naming and icon (2026-10-30)
The app and the device are both called VOICE in every user-facing string (app, alerts, API error messages). Internal ids (`medrem` project/db/storage keys, the firmware's fixed device id `pillbox`) stay unchanged so existing data and the ESP32 keep working. The app icon is generated by `tools/icons/make_icons.mjs` (sharp) from the supplied logo `tools/icons/logo-source.png`, so it can be tweaked and re-rendered.

## Fixed device address on any laptop (2026-10-31)
The client runs the repo on their own laptop, which gets internet from a phone hotspot. Phone hotspots give the laptop a different IP on every connection and cannot reserve addresses, but the ESP32 has `BACKEND_URL` compiled in. So the VOICE device joins the laptop's **Windows Mobile hotspot**, whose address is always `192.168.137.1` on every Windows machine: the firmware is flashed once with `http://192.168.137.1:5000` and works with any laptop that clones the repo. The phone app reaches the laptop over the phone hotspot; `scripts/start.ps1` (`start-voice.cmd`) detects that IP on each start and writes `LAN_IP` into `.env`. A cloud server or tunnel was rejected for now: the firmware speaks plain HTTP on port 5000 and the device endpoints have no secret, so they must stay on the local network.

## Optional hosted database: Supabase (2026-10-31) [superseded by D22: removed]
The user wanted free hosting. MySQL was considered and rejected: free Postgres hosts exist (Supabase, Neon) with pgvector, and a port would have rewritten the vector search, upserts and timezone handling for no gain. `DATABASE_URL` in `.env` now overrides the local db container; `DB_POOL_SIZE`/`DB_MAX_OVERFLOW` keep api + worker within the free connection limit. Use the Supavisor **session** pooler (IPv4, supports asyncpg prepared statements). A migration enables RLS on every public table so Supabase's auto-generated REST API exposes nothing; the backend owns the tables and bypasses RLS. Scan and reference image files stay in the local volume (not shared between laptops). Tests always use the local database.

## One-month cloud deployment: Google Cloud VM + device path secret (2026-10-31)
The user needs the system online for about a month. Render/Koyeb free tiers cannot host it (512 MB RAM, HTTPS only so the plain-HTTP firmware cannot connect, no free always-on worker); the home PC is behind CGNAT. Chosen: one Google Cloud e2-standard-2 VM in Singapore on the free-trial credit, running the existing prod compose (`deploy/server-setup.sh`), with HTTPS for the app through Caddy and a free `<ip>.sslip.io` name, and port 5000 open for the device. Because the device endpoints are then on the internet and the firmware only sends a fixed device id, `DEVICE_PATH_SECRET` moves them under `/d/<secret>/`: only `BACKEND_URL` changes in the firmware, which the contract already allows. Empty secret = LAN behaviour, unchanged.

## One VOICE for several people, and auto-detect (2026-10-31)
The client wanted to add a second person to a VOICE that was already paired, and to connect without typing the code. A person now points at their VOICE (`patients.device_id`); a VOICE row exists only while someone uses it. The firmware is unchanged: `GET /api/schedule` merges everyone's doses (ids are still `schedules.id`, so events find their owner), and when a VOICE is shared each dose name starts with the person's first name ("Lola: Losartan 50mg", still cut to 23 characters). The 5 slots are physical, so two people on one VOICE can never use the same slot: this is checked when a medicine gets a slot and when a person joins (409 `slot_taken`). Unknown scans go to the first person on the VOICE.
**Auto-detect:** an unpaired VOICE keeps polling and getting 403, so the server remembers its id in Redis for 5 minutes (max 20, fails open). `GET /api/v1/devices/nearby` lists those, plus paired VOICEs checking in now and the ones your people already use; the app polls it every 5 s on the pairing screens.
**Privacy:** joining a VOICE someone else set up is allowed (the code was already enough to pair before), but the VOICE screen only shows names and medicines of people you look after; others appear as "Another person".

## D22. Backend moves to Express + MySQL + Gemini (2026-11-04)
- **Context:** The backend was FastAPI + PostgreSQL/pgvector with local vision models (barcode, OCR, CLIP). The updated spec asks for Node.js 22 + Express + TypeScript, MySQL 8, Prisma, zod, and Google Gemini (free tier) for scans, with no local AI models. The Expo app and the flashed ESP32 firmware must not change.
- **Choice:** One `services/api` package with two entrypoints (`src/server.ts`, `src/worker.ts`) and the same layering (routes → services → repositories). Every `/api/v1` path, body and answer and the three device paths are unchanged, and the old tests were ported to Vitest + Supertest against real MySQL and Redis (185 tests). Redis, WebSocket realtime, the worker (now `node-cron`) and Docker Compose stay. The Python service, Alembic, pgvector, the Supabase option (Postgres only) and the Python simulator were removed. The simulator is now `tools/device-sim/sim.mjs` (Node, no dependencies).
- **Why:** Matches the new spec. Behaviour was kept identical on purpose, so the app needed only one Settings sentence (the Gemini notice), two scan labels and the new default port.
- **Data:** PostgreSQL data is not migrated (the demo seed recreates the demo person). An `.env` from the old version keeps working: unused variables are ignored, and `start-voice.cmd` adds the MySQL ones.

## D23. API port 5055 (2026-11-04)
- **Context:** The earlier version published port 5000. The spec fixes the device contract on **5055**, and the user's `.env` already had `API_PORT=5055`.
- **Choice:** The API listens on 5055 inside and outside the container (`${API_PORT:-5055}:5055`). Compose, Makefile, scripts, Caddy and docs were updated. Firmware flashed with `:5000` needs `API_PORT=5000` in `.env` (or a re-flash); nothing else differs.

## D24. Slot uniqueness is checked in code, not by an index (2026-11-04)
- **Context:** PostgreSQL had a partial unique index on `(patient_id, slot)` for active medicines. MySQL has no partial indexes, and slots are shared by everyone on one VOICE anyway, so the rule never fit a single-column index.
- **Choice:** `medicineService.checkSlot` and `patientService.pairDevice` enforce it and answer 409 `slot_taken`. The check constraints (slot 1–5, qty ≥ 0, status values) moved to zod validation, because Prisma cannot model them.
- **Why:** Keeps `schema.prisma` the single source of truth. Two simultaneous requests could in theory both pass the check; accepted for a household app.

## D25. Scan pipeline: Gemini reads, code decides (2026-11-04)
- **Choice:** One Gemini call per scan (JSON-only response schema; the prompt demands `null` when unsure). Code accepts a match only if the id belongs to that box and `confidence ≥ SCAN_MIN_CONFIDENCE` (0.7). With no id it fuzzy-matches the printed name and strength (similarity ≥ 0.8, a different strength rules a candidate out, 0.1 lead over the runner-up). The answer to the camera is read from MySQL, never from the model; `readExpiry` is stored for information only. The call is aborted at 8 s, the pipeline is capped at 9 s, any failure answers `{"found":false}`, and the camera never sees a 5xx. One scan at a time per box (Redis lock) and at most `GEMINI_MAX_PER_MINUTE` calls per minute keep the free tier from returning 429.
- **App compatibility:** `scans.method` keeps its old values for the app: `llm` = Gemini picked the id, `ocr` = the fuzzy name match, `none`. The `ocrExpiry` field now carries the expiry Gemini read.
- **Privacy:** Google may use free-tier inputs to improve its products. The notice is in the app's Settings → Privacy and in `docs/setup.md`. Only the photo and the box's medicine list (id, name, strength, barcode) are sent. Reference photos are sent only with `SCAN_USE_REFERENCES=true`.
- **Model:** `GEMINI_MODEL` defaults to `gemini-3.5-flash` (2026-11-05: `gemini-2.5-flash` is retired for new keys). `make eval-vision` with a real key passed 14 of 14 samples, 0 wrong, worst case 3.3 s. Gemini 3 needs `thinkingLevel: MINIMAL` and a 800 token cap, otherwise the JSON comes back empty.

## D26. Test strategy on MySQL (2026-11-04)
- **Choice:** Each Vitest test starts from an empty database (`DELETE FROM users / patients / devices`, which cascades) and a frozen clock (`Date` only, 2026-10-30 07:00 PH). The harness refuses to run unless the database name ends in `_test`. Gemini is replaced by a fake and the Expo push call by an injected `fetch`. The route registry makes the security checks structural: `route()` always authenticates, validates and checks patient access.
- **Why:** Rolling back a transaction per test (as before) does not fit Prisma's connection pool, and truncating every table per test was too slow.

## D27. Container user keeps uid 10001 (2026-11-04)
The Python image ran as uid 10001. The Node image creates the same user, so an existing `scans` volume (up to 30 days of photos) stays writable after the upgrade.

## D28. Add a medicine by scanning it on the VOICE (2026-11-05)
- **Choice:** the add-medicine screen can fill itself from the box's camera. The app calls `POST /patients/:id/scans/learn`, the next scan from that VOICE is read by Gemini even when nothing is registered yet, and the newest scan carries `readName`, `readStrength` and the expiry. The phone barcode scan stays as the other way.
- **Reading boxes with no medicines:** every scan now asks the AI (rate limited by `GEMINI_MAX_PER_MINUTE`), so an empty box can still suggest a name. The flag only decides who gets the scan and that no unknown-package alert is raised.
- **Firmware:** unchanged: the box sends the usual `POST /api/scan` and gets `{"found":false}`.
- **Guessing from looks (2026-11-05):** the AI reads printed text first; when it cannot, it may suggest a product from the packaging, marked `guessed`. A box answer on a registered medicine needs 0.9 confidence for such a guess (0.7 for printed text), and a guessed name is only ever shown to the caregiver to confirm. The phone can send a photo of a box too (`POST /patients/:id/medicines/read-package`); that photo is not stored. Switch off with `SCAN_GUESS_FROM_LOOKS=false`.
- **Suggestion on the box (2026-11-05):** an unregistered package gets `{"found":false,"guess":"<name strength>","guessed":<true if from looks>}`. Exactly `{"found":false}` when nothing was read. Additive: the three device paths and every other field are unchanged.
- **Model fallback and the daily cap (2026-11-05):** Google's free tier allows about 20 requests per day per model on the Gemini 3 models, and some models answer 503 "high demand". `GEMINI_MODEL` is tried first, then `GEMINI_FALLBACK_MODELS` (default `gemini-3-flash-preview,gemini-3.6-flash`), each with its own `GEMINI_ATTEMPT_MS` time slot (4.5 s; the last model gets the rest of `GEMINI_TIMEOUT_MS`). Each model has its own quota, so this multiplies the daily allowance. A per-day 429 is reported as `daily_limit` and the app says so. For real daily use, enable billing on the Google project (reading a box costs a fraction of a cent).

## D29. Backup readers behind Gemini (Groq, Cloudflare)
Gemini's free tier is about 20 requests a day per model. When Gemini cannot answer (quota, overload, no key), the scan tries Groq and then Cloudflare Workers AI, whichever have keys set. Groq runs qwen/qwen3.8-27b (its Llama 4 Scout vision model is gone) and Cloudflare runs Llama 4 Scout, both in the OpenAI chat format, the same prompt and the same checks in code. Off by default; no key means no call. All Gemini models together get VISION_PRIMARY_MS so the backups have time left inside the 9 s budget.
