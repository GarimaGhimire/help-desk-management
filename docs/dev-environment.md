# Development Environment

## Tooling (decided)
- **Go 1.22+** backend, **Next.js 14** (App Router) frontend, **PostgreSQL 15**
- **DB access:** `sqlc` (generates type-safe Go from `backend/sql/`) + `pgx/v5`
- **Migrations:** `golang-migrate` (up/down SQL pairs in `backend/migrations/`)
- **OTP delivery (dev):** logged to backend console — swap for Twilio/SES later
- **Auth:** JWT sessions

## Local Stack (docker-compose)
- **PostgreSQL 15** on `localhost:5432` (user/pass/db: `helpdesk`/`helpdesk_dev`/`helpdesk`)
- **migrate** service — runs golang-migrate `up` before backend starts
- **Backend** (Go) on `localhost:8080`
- **Frontend** (Next.js) on `localhost:3000`

## Common Commands (Makefile)
```bash
make dev          # build + run full stack
make migrate      # run pending migrations
make migrate-down # rollback 1 step
make sqlc         # regenerate Go code from SQL (needs local sqlc)
make sqlc-generate # same, via docker (no local install needed)
make test         # go test ./...       (deps: golangci-lint, gofumt)
```

## Adding a migration
```bash
docker compose run --rm -v $(pwd)/backend/migrations:/migrations migrate/migrate \
  create -ext sql -dir /migrations -seq add_users_dept
# fill the generated .up.sql / .down.sql, then `make migrate`
```

## sqlc workflow
1. Edit `backend/sql/queries/*.sql` (canonical SQL source)
2. Update `backend/sql/schema.sql` if the schema changed (and mirror it in a new migration)
3. `make sqlc-generate` → writes `backend/internal/db/`
4. CI runs `sqlc diff` to ensure generated code is committed and current

## Directory Layout
```
.
├── backend/            # Go API
│   ├── cmd/api/        # entrypoint
│   ├── internal/       # auth, users, groups, messages, documents, search
│   ├── pkg/            # db, middleware
│   └── migrations/     # SQL schema + seed
├── frontend/           # Next.js 14 (App Router, src/)
│   └── src/
│       ├── app/        # (auth), (dashboard) route groups
│       ├── components/
│       ├── lib/        # api client, websocket hook, i18n
│       └── locales/    # en.json, ne.json
├── docs/               # ER diagram, API reference
├── docker-compose.yml
└── .github/workflows/  # CI
```