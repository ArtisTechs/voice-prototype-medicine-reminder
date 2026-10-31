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
- `POSTGRES_PASSWORD=` anything long

## 4. Open the firewall (PowerShell as Administrator)
The WiFi network must use the **Private** profile (Settings → Network → Wi-Fi → your network → Private).
```powershell
New-NetFirewallRule -DisplayName "MedRem API 5000"  -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "MedRem Expo 8081" -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow -Profile Private
```

## 5. Start
```bash
make up        # = docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
make ps        # db, redis, api (healthy), worker, mobile, adminer
```
The first build downloads the Python and vision dependencies and the CLIP weights (~2–3 GB, 10–20 min). Later starts take seconds. The API runs migrations and seeds the demo data at startup.

Check from the PC (`http://localhost:5000/healthz`) and from the phone's browser (`http://<LAN_IP>:5000/healthz`). Both must show `{"status":"ok",...}`.

> **Port 5000 already in use?** The firmware needs 5000, so stop whatever holds it (`docker ps`; `Get-NetTCPConnection -LocalPort 5000`). For development without the real pillbox you can set `API_PORT=5055` in `.env`; then also set `EXPO_PUBLIC_API_URL=http://<LAN_IP>:5055`.

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
#define BACKEND_URL "http://192.168.137.1:5000"   // Windows Mobile hotspot address (same on every laptop), port 5000, plain HTTP
```
The ESP32-CAM sketch uses the same base URL. Flash both boards. In the app: person → **Pillbox** → pair `pillbox` (the demo seed already pairs it). Within 60 s the pillbox status turns **Online**.

## 9. Everyday commands
| | |
|---|---|
| `make logs` / `make logs-api` | follow the logs |
| `make sim` | device simulator full-day walk-through |
| `make test` | backend (pytest, real Postgres) + app (Jest) |
| `make eval-vision` | scan accuracy/timing report |
| `make migrate`, `make revision m="…"` | Alembic |
| `make seed`, `make reset-seed` | demo data |
| `make psql`, Adminer at http://localhost:8089 | database (server `db`, user/db from `.env`) |
| `make down` / `make nuke` | stop / stop and delete the data volumes |

## 10. Production
`make prod-up` uses `docker-compose.prod.yml`: no hot reload, no Adminer or Expo, `ENV=prod` (refuses the example JWT secret), and Caddy with automatic HTTPS for `APP_DOMAIN` (open ports 80/443 and point DNS at the server). Caddy only exposes `/api/v1` and `/healthz`. The ESP32s keep using `http://<LAN_IP>:5000` on the LAN; **never forward port 5000 to the internet.** Build the app with `eas build --profile production` and set `EXPO_PUBLIC_API_URL=https://<APP_DOMAIN>`.
