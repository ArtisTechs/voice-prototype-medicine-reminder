# Expo dev server for the caregiver app (dev only). See docs/setup.md for opening it on a phone.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
 && md5sum package-lock.json | cut -d' ' -f1 > node_modules/.lock-hash

FROM node:22-bookworm-slim AS dev
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global PATH=/home/node/.npm-global/bin:$PATH \
    EXPO_NO_TELEMETRY=1
WORKDIR /app
RUN chown node:node /app
USER node
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
EXPOSE 8081
CMD ["sh", "./docker-start.sh"]
