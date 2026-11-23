# Deploy MIRA on Google Cloud (free trial, about one month)

Everything (API, worker, MySQL, Redis, HTTPS; scan recognition calls Google Gemini) runs on one virtual machine with the production Docker setup. The MIRA device and the phone app reach it from any network with internet.

```
 phone app ──HTTPS──► https://34-87-1-2.sslip.io ─┐
                                                  ├─► VM (Singapore): Caddy → api, worker, db, redis
 MIRA device ──HTTP──► http://34.87.1.2:5055/d/<secret> ─┘
```

## 1. Create the account (once)
1. Go to [cloud.google.com/free](https://cloud.google.com/free) → **Get started for free**. Sign in with a Google account, add a card for verification. The trial gives free credit for 90 days and does not charge the card unless you choose to upgrade.
2. In the console, a project ("My First Project") is created for you. Keep it selected.

## 2. Create the server
1. Open **Compute Engine → VM instances** (click *Enable* if asked and wait a minute) → **Create instance**.
2. **Machine configuration**
   - Name: `voice-server`
   - Region: **asia-southeast1 (Singapore)**, any zone
   - Series **E2**, machine type **e2-standard-2** (2 vCPU, 8 GB memory)
3. **OS and storage** → **Change**: Operating system **Ubuntu**, version **Ubuntu 24.04 LTS (x86/64)**, size **40 GB**, Balanced persistent disk → *Select*.
4. **Networking**
   - Firewall: tick **Allow HTTP traffic** and **Allow HTTPS traffic**.
   - Network tags: type `voice-server`.
   - Network interfaces → click the default interface → **External IPv4 address** → **Reserve static external IP address**, name `voice-ip` → *Reserve*. (A static IP never changes, so the device is flashed once.)
5. Click **Create**. When the VM is green, write down its **External IP**, e.g. `34.87.1.2`.

## 3. Open port 5055 for the device
1. **VPC network → Firewall → Create firewall rule**.
2. Name `voice-device`, Direction **Ingress**, Action **Allow**, Targets **Specified target tags** → `voice-server`.
3. Source IPv4 ranges `0.0.0.0/0`. Protocols and ports: **TCP** `5055`. → *Create*.

## 4. Get the code onto the server
On the VM row click **SSH** (a terminal opens in the browser). Then:

**Public repo:**
```bash
git clone https://github.com/ArtisTechs/voice-prototype-medicine-reminder.git voice && cd voice
```
**Private repo:** give the server a read-only key.
```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
```
Copy the printed line → GitHub repo → **Settings → Deploy keys → Add deploy key** (leave *Allow write access* off). Then:
```bash
git clone git@github.com:ArtisTechs/voice-prototype-medicine-reminder.git voice && cd voice
```

## 5. Start MIRA
```bash
bash deploy/server-setup.sh --demo
```
`--demo` adds the demo account (demo@example.com / demo1234) and patient; leave it off for a clean start. The first run installs Docker, builds the images (10–20 min) and prints:
```
App API (EXPO_PUBLIC_API_URL):  https://34-87-1-2.sslip.io
MIRA device BACKEND_URL:       http://34.87.1.2:5055/d/3f9c...
```
Open `https://34-87-1-2.sslip.io/healthz` in a browser: it must show `"status":"ok"`.

`.env` on the server holds the secrets (database password, sign-in key, device secret). It is created once and never leaves the server. `sslip.io` is a free name that points at the IP, so Caddy can get a real HTTPS certificate without buying a domain.

## 6. Flash the device
In both ESP32 sketches set the printed value, then flash:
```cpp
#define BACKEND_URL "http://34.87.1.2:5055/d/3f9c..."
```
The device needs a Wi-Fi network with internet (home Wi-Fi or a phone hotspot). In the app, the person's **MIRA** screen turns **Online** within a minute.

The secret in the URL is the device's password: the bare `/api/schedule`, `/api/scan` and `/api/events` answer 404 on this server.

## 7. The phone app
- **Quick test with Expo Go:** in your laptop's `.env` set `EXPO_PUBLIC_API_URL=https://34-87-1-2.sslip.io` and run `start-voice.cmd`. The app then talks to the server; Expo Go still loads the app itself from the laptop.
- **Installable Android app (no laptop needed):** put the API URL into `apps/mobile/eas.json` → `build.server.env.EXPO_PUBLIC_API_URL`, then in `apps/mobile`:
  ```bash
  npx eas-cli@latest login
  npx eas-cli@latest init
  npx eas-cli@latest build --platform android --profile server
  ```
  EAS builds an APK in the cloud (free plan) and gives a download link/QR code to install on Android phones.

## Everyday
| | On the server, in `~/voice` |
|---|---|
| Update after `git pull` | `bash deploy/server-setup.sh` |
| Logs | `sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f api` |
| Restart | `sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml restart` |
| Back up the data | `sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db pg_dump -U medrem medrem > voice-backup.sql` |

## End of the month
1. Back up the data (table above), then download it: SSH window → gear icon → **Download file** → `/home/<you>/voice/voice-backup.sql`.
2. **Compute Engine → VM instances** → delete `voice-server`; **VPC network → IP addresses** → release `voice-ip`. Deleting both stops all usage of the credit.

## Scans need a Gemini key
Edit `.env` on the server and set `GEMINI_API_KEY=` (free key: https://aistudio.google.com/apikey), then `sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`. Google may use free-tier inputs to improve its products.
