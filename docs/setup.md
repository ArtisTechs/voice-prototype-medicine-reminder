# Setup (Windows 10/11)

## 1. Install
- **Docker Desktop** (WSL 2 backend). Start it and wait for "Engine running".
- **Git** (Git for Windows includes Git Bash).
- **make** (optional): `winget install ezwinports.make`, then reopen the terminal. Without make, run the command that each Makefile target wraps (each one is a single `docker compose …` line).
- On the phone: **Expo Go** from the Play Store or App Store (it must support Expo SDK 58).

## 2. Find this PC's LAN IP
**Easiest: run `start-voice.cmd`.** It detects the IP, writes `LAN_IP` into `.env` (creating `.env` with random secrets on the first run) and starts the stack. `setup-voice.cmd` opens the firewall once. For the VOICE device, use the Windows Mobile hotspot: its address is always `192.168.137.1`, so the firmware never needs a laptop-specific IP (see the README, D-entry "Fixed device address").

Manual way: `ipconfig` → section **Wireless LAN adapter Wi-Fi** → **IPv4 Address**, e.g. `192.168.0.215`. Do not use the `vEthernet (WSL)` address.

## 3. Configure
```bash
git clone <repo> medicine-reminder && cd medicine-reminder
cp .env.example .env
```
Edit `.env`:
- `LAN_IP=192.168.0.215` (your IP)
- `JWT_SECRET=` paste the output of `make secret`
- `MYSQL_PASSWORD=` and `MYSQL_ROOT_PASSWORD=` anything long
- `GEMINI_API_KEY=` a free key from https://aistudio.google.com/apikey (needed for package scans; everything else works without it)

> **Privacy notice (free tier):** Google may use what is sent to the free Gemini tier (the package photos and the list of registered medicine names) to improve its products. The same one-line notice is in the app under Settings → Privacy. The key stays in `.env` on the server: never in the app, the firmware or git.

## 4. Open the firewall (PowerShell as Administrator)
The WiFi network must use the **Private** profile (Settings → Network → Wi-Fi → your network → Private).
```powershell
New-NetFirewallRule -DisplayName "VOICE API 5055"  -Direction Inbound -Protocol TCP -LocalPort 5055 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "VOICE Expo 8081" -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow -Profile Private
```

## 5. Start
```bash
make up        # = docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
make ps        # db (MySQL), redis, api (healthy), worker, mobile, adminer
```
The first build installs the Node dependencies (a few minutes). Later starts take seconds. The API runs the database migrations and seeds the demo data at startup.

Check from the PC (`http://localhost:5055/healthz`) and from the phone's browser (`http://<LAN_IP>:5055/healthz`). Both must show `{"status":"ok",...}`.

> **Port 5055 already in use?** The firmware needs 5055, so stop whatever holds it (`docker ps`; `Get-NetTCPConnection -LocalPort 5055`). For development without the real pillbox you can set `API_PORT=5056` in `.env`; then also set `EXPO_PUBLIC_API_URL=http://<LAN_IP>:5056`.

> **An `.env` from the PostgreSQL version?** `start-voice.cmd` upgrades it automatically (adds the `MYSQL_*` values, removes the old database settings). By hand: add `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `GEMINI_API_KEY`, and delete `DATABASE_URL`/`POSTGRES_*`/`VISION_*`. The old PostgreSQL data is not carried over; the demo seed recreates the demo person.

## 6. Open the app on the phone
`make logs-mobile` shows a QR code. Scan it with Expo Go (Android) or the Camera app (iOS), or type `exp://<LAN_IP>:8081` in Expo Go. Sign in with **demo@example.com / demo1234**.

- **Hot reload:** edits under `apps/mobile` sync into the container every second (D17).
- **LAN blocked** (guest WiFi, client isolation, corporate network): set `EXPO_TUNNEL=true` in `.env` and run `make up` again. Expo then serves through an ngrok tunnel, and the QR code uses a public URL. The API must still be reachable from the phone (same WiFi, or expose it).

## 7. Push notifications (development build)
Expo Go on Android cannot receive remote push (SDK 53+). In-app alerts still arrive instantly over WebSocket. For real push:
1. Create a free Expo account and run `npx eas-cli@latest login` in `apps/mobile`.
2. `npx eas-cli@latest init`, then copy the project id into `.env` as `EXPO_PUBLIC_EXPO_PROJECT_ID`.
3. `npx eas-cli@latest build --profile development --platform android`, then install the APK on the phone.
4. Set `EXPO_CLIENT=dev-client` in `.env`, run `make up`, and open the project from the development build.
5. In the app: **Home → Turn on notifications**. The token is registered with the backend, and the worker sends alerts through the Expo push service. Set `EXPO_ACCESS_TOKEN` if your Expo project has "enhanced push security" on.

## 8. Connect the real pillbox
In the **main ESP32 sketch**, change only:
```cpp
#define BACKEND_URL "http://192.168.137.1:5055"   // Windows Mobile hotspot address (same on every laptop), port 5055, plain HTTP
```
The ESP32-CAM sketch uses the same base URL. Flash both boards. In the app: person → **Pillbox** → pair `pillbox` (the demo seed already pairs it). Within 60 s the pillbox status turns **Online**.

## 9. Everyday commands
| | |
|---|---|
| `make logs` / `make logs-api` | follow the logs |
| `make sim` | device simulator full-day walk-through |
| `make test` | backend (Vitest + Supertest, real MySQL + Redis) + app (Jest) |
| `make eval-vision` | scan accuracy/timing report with the real Gemini model |
| `make migrate`, `make revision m="…"` | Prisma migrations (review the generated SQL, then commit it) |
| `make seed`, `make reset-seed` | demo data |
| `make mysql`, Adminer at http://localhost:8089 | database (server `db`, user/password from `.env`) |
| `make down` / `make nuke` | stop / stop and delete the data volumes |

## 10. Production
`make prod-up` uses `docker-compose.prod.yml`: no hot reload, no Adminer or Expo, `ENV=prod` (refuses the example JWT secret), and Caddy with automatic HTTPS for `APP_DOMAIN` (open ports 80/443 and point DNS at the server). Caddy only exposes `/api/v1` and `/healthz`. The ESP32s keep using `http://<LAN_IP>:5055` on the LAN; **never forward port 5055 to the internet** (or set `DEVICE_PATH_SECRET`, see docs/deploy-gcp.md). Build the app with `eas build --profile production` and set `EXPO_PUBLIC_API_URL=https://<APP_DOMAIN>`.
