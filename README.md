# Chat App Server

Bun + Hono + Socket.IO + PostgreSQL. REST API + real-time WebSocket.

## Requirements

- Docker & Docker Compose (recommended)
- Or: Bun, PostgreSQL 16

## Quick Start

```bash
# 1. Configure
cp .env.example .env
# Edit .env — set JWT_SECRET to a random string

# 2. Start
docker compose up -d --build

# 3. Migrate (first time only)
docker compose exec app bun src/migrate.ts

# 4. Verify
curl http://localhost:3000/healthz
curl http://localhost:3000/readyz
```

## Without Docker

```bash
# Start Postgres
docker run -d --name chat-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=chat \
  -p 5432:5432 \
  postgres:16-alpine

# Install & run
bun install
bun src/migrate.ts
bun dev   # or: bun src/index.ts
```

## Environment (.env)

| Variable | Default | Required |
|----------|---------|----------|
| PORT | 3000 | |
| DATABASE_URL | postgres://postgres:postgres@localhost:5432/chat | |
| JWT_SECRET | (dev default) | **Yes** — change for production |
| ADMIN_USERNAME | admin | |
| UPLOAD_DIR | ./uploads | |
| MAX_FILE_SIZE | 52428800 (50MB) | |
| CORS_ORIGIN | * | Comma-separated or `*` |
| STORAGE_BACKEND | local | `local` or `s3` |
| S3_ENDPOINT | — | Required if STORAGE_BACKEND=s3 |
| S3_BUCKET | chat-uploads | Required if STORAGE_BACKEND=s3 |
| S3_ACCESS_KEY | — | |
| S3_SECRET_KEY | — | |
| RATE_LIMIT_REQUESTS | 60 | |
| RATE_LIMIT_WINDOW_MS | 60000 | |
| SHUTDOWN_TIMEOUT_MS | 10000 | |

## Commands

```bash
docker compose up -d --build    # Start (build if needed)
docker compose down             # Stop (keeps data)
docker compose down -v          # Stop + wipe DB + uploads
docker compose logs app -f      # Follow logs
docker compose exec app bun src/migrate.ts  # Run migrations
```

## Access

| From | URL |
|------|-----|
| Same machine | http://localhost:3000 |
| Same WiFi | http://192.168.1.74:3000 |
| Anywhere | Cloudflare Tunnel or Tailscale |

## API Overview

- `POST /api/register` — `{ username, password }` → JWT
- `POST /api/login` — `{ username, password }` → JWT
- `GET /healthz` — Liveness
- `GET /readyz` — Readiness (checks DB)
- All other endpoints require `Authorization: Bearer <token>`

Full API reference in `AGENTS.md`.
