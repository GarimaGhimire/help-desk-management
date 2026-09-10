# Help Desk Management System

A real-time help desk and internal messaging system built for fintech teams.

## Tech Stack

- **Frontend:** Next.js (App Router), Tailwind CSS, shadcn/ui
- **Backend:** Go (Chi router, pgx, sqlc)
- **Database:** PostgreSQL 15
- **Real-time:** WebSockets
- **Auth:** OTP (SMS/Email) + JWT
- **i18n:** English / Nepali

## Quick Start

```bash
docker-compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8080
- PostgreSQL: localhost:5432

## Project Structure

```
/helpdesk-system
  /frontend     Next.js app
  /backend      Go API server
  /docs         Specs and diagrams
```

## Development

### Backend
```bash
cd backend
go run ./cmd/api
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Environment Variables

Create `.env` files in each service directory. See `.env.example` for reference.
