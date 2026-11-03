# syntax=docker/dockerfile:1.7
# VOICE API + worker (same image, two commands). Stages: base -> deps -> build -> dev (tests, reload) -> runtime (prod).
# `runtime` is the LAST stage on purpose: hosts that cannot pick a build target (Render) build it by default.

FROM node:22.21.1-bookworm-slim AS base
# Prisma's query engine needs openssl.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Non-root user. uid 10001 on purpose: it is the uid the previous (Python) image used, so an existing scans volume stays writable.
RUN groupadd -g 10001 app && useradd -u 10001 -g app -m -d /home/app app
WORKDIR /srv

# All dependencies (dev included): used to build and for the dev/test image.
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY prisma ./prisma
RUN npx prisma generate

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npx tsc -p tsconfig.build.json

# Development and tests: everything installed, source mounted by docker-compose.dev.yml.
FROM deps AS dev
ENV SEED_CMD="npx tsx prisma/seed.ts"
COPY . .
RUN mkdir -p /data/scans && chown -R app:app /data && chmod +x /srv/entrypoint.sh
USER app
EXPOSE 5055
ENTRYPOINT ["/srv/entrypoint.sh"]
CMD ["npx", "tsx", "src/server.ts"]

# Production dependencies only (the prisma CLI stays: the entrypoint runs `prisma migrate deploy`).
FROM base AS prod-deps
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev && npx prisma generate

FROM base AS runtime
ENV NODE_ENV=production SEED_CMD="node dist/prisma/seed.js"
COPY --from=prod-deps /srv/node_modules ./node_modules
COPY --from=build /srv/dist ./dist
COPY package.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations
COPY seed_assets ./seed_assets
COPY entrypoint.sh ./
# Non-root; /data/scans is the volume for scan photos and reference photos.
RUN mkdir -p /data/scans && chown -R app:app /data && chmod +x /srv/entrypoint.sh
USER app
EXPOSE 5055
ENTRYPOINT ["/srv/entrypoint.sh"]
CMD ["node", "dist/src/server.js"]
