#!/usr/bin/env bash
# Set up (or update) VOICE on a fresh Ubuntu 24.04 server: Google Cloud VM or any VPS.
# Run from the cloned repo:   bash deploy/server-setup.sh          (add --demo once for the demo account)
# Safe to re-run after `git pull`: .env and the database are kept.
set -euo pipefail
cd "$(dirname "$0")/.."

DEMO=false
[[ "${1:-}" == "--demo" ]] && DEMO=true
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml)

# 1. Docker
if ! command -v docker >/dev/null; then
  echo "== Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# 2. Swap, so the first image build never runs out of memory
if [[ -z "$(swapon --show)" ]]; then
  echo "== Adding 2 GB swap"
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# 3. .env (first run only): random secrets, prod mode, HTTPS name from the public IP
set_env() {  # key value; values are hex/hostnames, so | is a safe sed delimiter
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
if [[ ! -f .env ]]; then
  IP=$(curl -fsS https://api.ipify.org)
  DOMAIN="${IP//./-}.sslip.io"   # free name that resolves to IP; Caddy gets a real HTTPS certificate for it
  cp .env.example .env
  set_env ENV prod
  set_env LAN_IP "$IP"
  set_env APP_DOMAIN "$DOMAIN"
  set_env CORS_ORIGINS "https://$DOMAIN"
  set_env JWT_SECRET "$(openssl rand -hex 32)"
  set_env MYSQL_PASSWORD "$(openssl rand -hex 16)"
  set_env MYSQL_ROOT_PASSWORD "$(openssl rand -hex 16)"
  set_env DEVICE_PATH_SECRET "$(openssl rand -hex 12)"
  echo "== Created .env for $DOMAIN"
fi
get_env() { grep "^$1=" .env | cut -d= -f2-; }

# 4. Start (first build: a few minutes)
echo "== Building and starting VOICE"
"${COMPOSE[@]}" up -d --build

echo "== Waiting for the API"
for _ in $(seq 1 120); do
  curl -fsS http://localhost:5055/healthz >/dev/null 2>&1 && break
  sleep 5
done
curl -fsS http://localhost:5055/healthz >/dev/null || { echo "API not healthy yet. Check: ${COMPOSE[*]} logs api"; exit 1; }

if $DEMO; then
  "${COMPOSE[@]}" exec -T api node dist/prisma/seed.js
fi

IP=$(get_env LAN_IP)
cat <<EOF

================ VOICE is running ================
App API (EXPO_PUBLIC_API_URL):  https://$(get_env APP_DOMAIN)
Check in a browser:             https://$(get_env APP_DOMAIN)/healthz
VOICE device BACKEND_URL:       http://$IP:5055/d/$(get_env DEVICE_PATH_SECRET)
Keep the device URL private: it is the device's password.
Logs: ${COMPOSE[*]} logs -f api
EOF
