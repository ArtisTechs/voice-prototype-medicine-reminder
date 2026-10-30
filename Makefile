# Thin wrappers over docker compose. Every recipe is one command you can also paste without make.
DEV  := docker compose -f docker-compose.yml -f docker-compose.dev.yml
PROD := docker compose -f docker-compose.yml -f docker-compose.prod.yml
SIM_BASE ?= http://localhost:5000

.PHONY: up down logs logs-api logs-mobile ps build migrate revision seed reset-seed test test-api \
        test-contract test-mobile sim eval-vision shell-api mobile-sh psql secret prod-up prod-down nuke

up:            ## start the dev stack (db, redis, api, worker, mobile, adminer)
	$(DEV) up -d --build
	@echo "API: http://localhost:5000/healthz   Docs: http://localhost:5000/docs   Adminer: http://localhost:8089"
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

migrate:
	$(DEV) exec api alembic upgrade head

revision:      ## make revision m="add thing"
	$(DEV) exec api alembic revision --autogenerate -m "$(m)"

seed:
	$(DEV) exec api python -m app.seed

reset-seed:
	$(DEV) exec api python -m app.seed --reset

test: test-api test-mobile

test-api:
	$(DEV) run --rm api-test pytest -q

test-contract:
	$(DEV) run --rm api-test pytest -q tests/contract

test-mobile:
	$(DEV) run --rm --no-deps mobile npm test -- --ci

sim:           ## full-day walk-through against the running stack
	$(DEV) run --rm --no-deps -w /sim api-test python sim.py --base http://api:5000 day

eval-vision:
	$(DEV) run --rm api-test python -m scripts.eval_vision

shell-api:
	$(DEV) exec api sh

mobile-sh:
	$(DEV) exec mobile sh

psql:
	$(DEV) exec db sh -c 'psql -U $$POSTGRES_USER $$POSTGRES_DB'

secret:
	@docker run --rm python:3.12-slim-bookworm python -c "import secrets;print(secrets.token_urlsafe(48))"

prod-up:
	$(PROD) up -d --build

prod-down:
	$(PROD) down

nuke:          ## stop and DELETE volumes (database, scans)
	@read -p "Delete the database and scan images? [y/N] " a; [ "$$a" = "y" ] && $(DEV) down -v || echo cancelled
