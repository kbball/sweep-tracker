VERSION := $(shell cat VERSION)
COVER_MIN := 80

.PHONY: web build test cover db
web:
	cd web && npm ci && npm run build

build: web
	CGO_ENABLED=0 go build -ldflags "-X main.version=$(VERSION)" -o bin/sweeptracker ./cmd/sweeptracker

db: ## throwaway Postgres for integration tests
	docker run -d --rm --name sweep-test-pg -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:17-alpine

test:
	go vet ./...
	go test -race ./...

cover:
	go test -coverprofile=coverage.out ./...
	@go tool cover -func=coverage.out | tail -1
	@go tool cover -func=coverage.out | awk -v min=$(COVER_MIN) '/^total:/ { sub("%","",$$3); if ($$3+0 < min) { print "coverage below " min "%"; exit 1 } }'
