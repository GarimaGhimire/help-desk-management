.PHONY: dev up down down-volumes logs migrate migrate-down sqlc sqlc-generate sqlc-verify test lint fmt build

# ---------- Local dev ----------
dev:
	docker compose up --build

up:
	docker compose up -d

down:
	docker compose down

down-volumes:
	docker compose down -v

logs:
	docker compose logs -f

# ---------- Migrations (golang-migrate) ----------
migrate:
	docker compose run --rm migrate -path=/migrations -database=postgres://helpdesk:helpdesk_dev@postgres:5432/helpdesk?sslmode=disable up

migrate-down:
	docker compose run --rm migrate -path=/migrations -database=postgres://helpdesk:helpdesk_dev@postgres:5432/helpdesk?sslmode=disable down 1

# ---------- sqlc ----------
sqlc:
	cd backend && sqlc generate

sqlc-generate:
	cd backend && docker run --rm -v $$(pwd):/src -w /src sqlc/sqlc:latest generate

sqlc-verify:
	cd backend && docker run --rm -v $$(pwd):/src -w /src sqlc/sqlc:latest diff

# ---------- Go ----------
build:
	cd backend && go build ./...

test:
	cd backend && go test ./...

lint:
	cd backend && go vet ./... && test -z "$$(gofmt -l .)"

fmt:
	cd backend && gofmt -w .