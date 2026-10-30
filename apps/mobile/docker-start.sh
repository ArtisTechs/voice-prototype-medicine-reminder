#!/bin/sh
# Container start for the Expo dev server.
set -e

# node_modules lives in a named volume: reinstall when package-lock.json changed.
HASH=$(md5sum package-lock.json | cut -d' ' -f1)
if [ ! -f node_modules/.lock-hash ] || [ "$(cat node_modules/.lock-hash)" != "$HASH" ]; then
  echo "package-lock.json changed: npm ci"
  npm ci --no-audit --no-fund
  echo "$HASH" > node_modules/.lock-hash
fi

echo "API for the app: ${EXPO_PUBLIC_API_URL}"
if [ "${EXPO_TUNNEL}" = "true" ]; then
  command -v ngrok >/dev/null 2>&1 || npm install -g @expo/ngrok@^4 --no-audit --no-fund
  exec npx expo start --tunnel --port 8081
fi
echo "Open in Expo Go: exp://${REACT_NATIVE_PACKAGER_HOSTNAME}:8081"
exec npx expo start --lan --port 8081
