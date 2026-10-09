VERSION := $(shell cat VERSION)
COVER_MIN := 80

.PHONY: web build test cover db image smoke dev-up dev-down dev-reset dev-env
web:
	cd web && npm ci && npm run build

build: web
	CGO_ENABLED=0 go build -ldflags "-X main.version=$(VERSION)" -o bin/sweeptracker ./cmd/sweeptracker

db: ## throwaway Postgres for integration tests
	docker run -d --rm --name sweep-test-pg -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:17-alpine

DEV_COMPOSE := docker compose -f docker-compose.dev.yml
DEV_DB_PORT := $(or $(SWEEP_DEV_DB_PORT),5433)
DEV_MQTT_PORT := $(or $(SWEEP_DEV_MQTT_PORT),1884)

dev-up: ## Postgres + Mosquitto for local development
	$(DEV_COMPOSE) up -d --wait
	@$(MAKE) --no-print-directory dev-env

dev-down: ## stop the dev dependencies (data is kept)
	$(DEV_COMPOSE) down

dev-reset: ## stop the dev dependencies and delete their data
	$(DEV_COMPOSE) down -v

dev-env: ## print the environment the app needs to use the dev dependencies
	@echo "export SWEEP_DATABASE_URL='postgres://postgres:sweep@localhost:$(DEV_DB_PORT)/sweep?sslmode=disable'"
	@echo "export SWEEP_MQTT_BROKER='tcp://localhost:$(DEV_MQTT_PORT)'"

IMAGE ?= ghcr.io/kbball/sweep-tracker

image: ## build the Docker image, tagged with the VERSION file and latest
	docker build --build-arg VERSION=$(VERSION) -t $(IMAGE):$(VERSION) -t $(IMAGE):latest .

smoke: image ## run the image against real Postgres and MQTT containers (the check CI runs)
	scripts/smoke-image.sh $(IMAGE):$(VERSION) $(VERSION)

test:
	go vet ./...
	go test -p 1 -race ./...

cover:
	go test -p 1 -coverprofile=coverage.out ./...
	@go tool cover -func=coverage.out | tail -1
	@go tool cover -func=coverage.out | awk -v min=$(COVER_MIN) '/^total:/ { sub("%","",$$3); if ($$3+0 < min) { print "coverage below " min "%"; exit 1 } }'
