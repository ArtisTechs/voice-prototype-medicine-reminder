# Thin wrappers over docker compose. Every recipe is one command you can also paste without make.
DEV  := docker compose -f docker-compose.yml -f docker-compose.dev.yml
PROD := docker compose -f docker-compose.yml -f docker-compose.prod.yml
API_PORT ?= 5055

.PHONY: up down logs logs-api logs-mobile ps build migrate revision seed reset-seed test test-api \
        test-contract test-mobile sim eval-vision typecheck shell-api mobile-sh mysql secret prod-up prod-down nuke

up:            ## start the dev stack (db, redis, api, worker, mobile, adminer)
	$(DEV) up -d --build
	@echo "API: http://localhost:$(API_PORT)/healthz   Docs: http://localhost:$(API_PORT)/docs   Adminer: http://localhost:8089"
	@echo "Expo: make logs-mobile (QR code)"

down:
	$(DEV) down

logs:
	$(DEV) logs -f --tail=100

logs-api:
	$(DEV) logs -f --tail=100 api worker

logs-mobile:
	$(DEV) logs -f --tail=200 mobile

ps:
	$(DEV) ps

build:
	$(DEV) build

migrate:       ## apply committed migrations (the api container also does this at start)
	$(DEV) exec api npx prisma migrate deploy

revision:      ## make revision m="add thing": generate a migration from schema.prisma (review it, then commit it)
	$(DEV) exec -e DATABASE_URL="mysql://root:$${MYSQL_ROOT_PASSWORD:-medrem-root}@db:3306/medrem" api npx prisma migrate dev --name "$(m)"

seed:
	$(DEV) exec api npx tsx prisma/seed.ts

reset-seed:
	$(DEV) exec api npx tsx prisma/seed.ts --reset

test: test-api test-mobile

test-api:
	$(DEV) run --rm api-test npm test

test-contract:
	$(DEV) run --rm api-test npm run test:contract

typecheck:
	$(DEV) run --rm api-test npm run typecheck

test-mobile:
	$(DEV) run --rm --no-deps mobile sh -c "node /host/scripts/poll-sync.js --once && npm test -- --ci"

sim:           ## full-day walk-through against the running stack (needs GEMINI_API_KEY for the scan step)
	$(DEV) run --rm sim --base http://api:5055 day

eval-vision:   ## scan accuracy + timing with the real Gemini model over services/api/tests/vision_samples
	$(DEV) run --rm api-test npm run eval-vision

shell-api:
	$(DEV) exec api sh

mobile-sh:
	$(DEV) exec mobile sh

mysql:
	$(DEV) exec db sh -c 'mysql -u"$$MYSQL_USER" -p"$$MYSQL_PASSWORD" "$$MYSQL_DATABASE"'

secret:
	@docker run --rm node:22.21.1-bookworm-slim node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

prod-up:
	$(PROD) up -d --build

prod-down:
	$(PROD) down

nuke:          ## stop and DELETE volumes (database, scans)
	@read -p "Delete the database and scan images? [y/N] " a; [ "$$a" = "y" ] && $(DEV) down -v || echo cancelled
