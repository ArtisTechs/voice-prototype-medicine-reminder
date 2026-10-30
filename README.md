# Medicine reminder prototype

Backend + caregiver app for an ESP32 pillbox. Full docs are in `docs/`. The project skills (`.claude/skills/`) hold the conventions.

```bash
cp .env.example .env      # set LAN_IP and JWT_SECRET
make up                   # db, redis, api (:5000), worker, Expo (:8081), adminer (:8089)
make sim                  # device simulator full-day walk-through
make test                 # backend + app tests
```
