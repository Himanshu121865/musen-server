# Chat App — Agent Memory

## Project Scope
Private chat app for 2+ people. Backend-first (clients can be built in any language later).

## Tech Stack
| Layer | Choice |
|-------|--------|
| Runtime | **Bun** |
| Framework | **Hono** |
| Real-time | **Socket.IO** |
| Database | **PostgreSQL** |
| Auth | **bcrypt + JWT** (HS256, self-managed) |
| ORM | **Drizzle** |
| File storage | **Local filesystem** (`uploads/`) or **S3-compatible** (Tigris, MinIO, R2, B2) via `STORAGE_BACKEND` env var |
| Deployment | **Docker Compose** (self-host) or **Fly.io** (free tier, no credit card) |

## Authentication
- `POST /api/register` — username + password → bcrypt hash → store in DB
- `POST /api/login` — username + password → verify bcrypt → return JWT
- JWT passed as `Authorization: Bearer <token>` for REST
- JWT passed as `auth: { token }` for Socket.IO handshake
- All REST routes protected by JWT auth middleware (except register/login)

## Database Schema (9 tables)

### users
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| username | VARCHAR(50) UNIQUE | validated (alphanumeric + _-, 2-32 chars) |
| display_name | VARCHAR(100) | nullable |
| password_hash | TEXT | bcrypt |
| avatar_url | TEXT | nullable |
| bio | TEXT | nullable (Phase 1) |
| status | VARCHAR(20) | 'online', 'idle', 'dnd', 'invisible' (default: online) |
| custom_status | TEXT | nullable |
| custom_status_emoji | VARCHAR(10) | nullable |
| deleted_at | TIMESTAMPTZ | nullable (soft delete) |
| settings | TEXT | JSON string (parsed at runtime) |
| last_seen_at | TIMESTAMPTZ | updated on disconnect |
| created_at | TIMESTAMPTZ | |

### rooms
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| name | VARCHAR(100) | |
| type | VARCHAR(10) | 'dm' or 'group' |
| topic | TEXT | nullable (Phase 1) |
| icon_url | TEXT | nullable (Phase 1) |
| created_by | INT FK → users | |
| created_at | TIMESTAMPTZ | |

### room_members
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| room_id | INT FK → rooms | CASCADE delete |
| user_id | INT FK → users | CASCADE delete |
| role | VARCHAR(20) | 'admin' or 'member' |
| joined_at | TIMESTAMPTZ | |
| last_read_at | TIMESTAMPTZ | for read receipts |
| UNIQUE(room_id, user_id) | |

### messages
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| room_id | INT FK → rooms | CASCADE delete |
| user_id | INT FK → users | SET NULL on delete |
| reply_to_id | INT FK → messages | nullable (Phase 1) |
| content | TEXT | nullable (for file-only messages) |
| file_url | TEXT | nullable (signed URL in responses — Phase 2) |
| file_name | TEXT | nullable |
| file_size | INTEGER | nullable |
| file_type | VARCHAR(100) | nullable |
| edited_at | TIMESTAMPTZ | nullable |
| deleted_at | TIMESTAMPTZ | nullable (soft delete) |
| created_at | TIMESTAMPTZ | |
| Full-text search on `content` using GIN index with `to_tsvector('english', "content")` | |

### message_reactions
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| message_id | INT FK → messages | CASCADE delete |
| user_id | INT FK → users | CASCADE delete |
| emoji | VARCHAR(10) | |
| created_at | TIMESTAMPTZ | |
| UNIQUE(message_id, user_id, emoji) | |

### pinned_messages
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| room_id | INT FK → rooms | CASCADE delete |
| message_id | INT FK → messages | CASCADE delete |
| pinned_by | INT FK → users | |
| created_at | TIMESTAMPTZ | |
| UNIQUE(room_id, message_id) | |

### sessions (Phase 2)
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| user_id | INT FK → users | CASCADE delete |
| token_hash | TEXT | SHA-256 of JWT |
| device_info | TEXT | User-Agent header |
| ip_address | VARCHAR(45) | Supports IPv6 |
| last_seen_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

### invites (Phase 3)
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| code | VARCHAR(16) UNIQUE | Random base64url (12 chars) |
| room_id | INT FK → rooms | CASCADE delete |
| created_by | INT FK → users | Who created |
| max_uses | INTEGER | 0 = unlimited |
| use_count | INTEGER | Incremented on each join |
| expires_at | TIMESTAMPTZ | When it expires |
| created_at | TIMESTAMPTZ | |

### message_mentions (Phase 2)
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| message_id | INT FK → messages | CASCADE delete |
| user_id | INT FK → users | CASCADE delete |
| read_at | TIMESTAMPTZ | nullable (read tracking) |
| created_at | TIMESTAMPTZ | |

## REST API Endpoints

### Auth
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/register` | No | Create account |
| POST | `/api/login` | No | Get JWT |

### Users
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/me` | JWT | My profile (includes status, custom status, bio) |
| PATCH | `/api/me` | JWT | Update display name/avatar/bio/status/custom status |
| DELETE | `/api/me` | JWT | Soft-delete account (leave rooms) |
| PATCH | `/api/me/password` | JWT | Change password (invalidates other sessions) |
| GET | `/api/me/settings` | JWT | Get settings |
| PATCH | `/api/me/settings` | JWT | Update settings (merge) |
| GET | `/api/me/mentions` | JWT | Get @mentions for current user |
| GET | `/api/users` | JWT | List all users (excludes deleted, includes status) |
| GET | `/api/users/:id/status` | JWT | Online/offline status + presence status |

### Sessions (Phase 2)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/sessions` | JWT | List my sessions (device, IP, last seen) |
| DELETE | `/api/sessions/:id` | JWT | Revoke a session (remote logout) |

### Rooms
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/rooms` | JWT | My rooms (with unread counts) |
| POST | `/api/rooms` | JWT | Create room (DM or group) |
| GET | `/api/rooms/:id` | JWT | Room details + members |
| PATCH | `/api/rooms/:id` | JWT | Rename room |
| POST | `/api/rooms/:id/members` | JWT | Add member (admin only) |
| DELETE | `/api/rooms/:id/members/:userId` | JWT | Remove member (admin only) |

### Messages
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/rooms/:id/messages?q=&limit=&before=` | JWT | History + full-text search (hit:true on matches) |
| POST | `/api/rooms/:id/messages` | JWT | Send message (supports replyToId, @mention parsing) |
| POST | `/api/rooms/:id/messages/bulk-delete` | JWT | Bulk soft-delete own messages |
| PATCH | `/api/messages/:id` | JWT | Edit message (owner only) |
| DELETE | `/api/messages/:id` | JWT | Soft-delete message (owner only) |
| POST | `/api/messages/:id/reactions` | JWT | Add reaction |
| DELETE | `/api/messages/:id/reactions/:emoji` | JWT | Remove reaction |
| POST | `/api/rooms/:id/pin/:messageId` | JWT | Pin message |
| DELETE | `/api/rooms/:id/pin/:messageId` | JWT | Unpin message |
| GET | `/api/rooms/:id/pinned` | JWT | List pinned |

### Invites (Phase 3)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/rooms/:id/invites` | JWT (admin) | Create invite (maxUses, expiresInHours) |
| GET | `/api/invites/:code` | JWT | Lookup invite (returns room info) |
| POST | `/api/invites/:code/join` | JWT | Join room via invite |

### Files
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/upload` | JWT | Upload file (multipart, field name: "file") |

### Health Checks (Phase 1)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/healthz` | No | Liveness probe |
| GET | `/readyz` | No | Readiness probe (checks DB) |

### Admin (mounted at `/admin`)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/admin` | JWT | Admin dashboard HTML |
| GET | `/admin/stats` | JWT | Stats JSON |
| DELETE | `/admin/messages/:id` | JWT | Admin delete any message |

## Socket.IO Events

### Client → Server
| Event | Payload | Purpose |
|-------|---------|---------|
| `join:room` | `{ roomId }` | Subscribe to room events |
| `leave:room` | `{ roomId }` | Unsubscribe |
| `message:send` | `{ roomId, content, fileUrl?, fileName?, fileSize?, fileType?, replyToId? }` | Send message |
| `message:edit` | `{ messageId, content }` | Edit message |
| `message:delete` | `{ messageId }` | Delete message |
| `message:react` | `{ messageId, emoji }` | Add reaction |
| `typing:start` | `{ roomId }` | Started typing |
| `typing:stop` | `{ roomId }` | Stopped typing |
| `status:update` | `{ status?, customStatus?, customStatusEmoji? }` | Update presence status |
| `read:receipt` | `{ roomId, lastReadMessageId }` | Mark as read |
| `call:offer` | `{ roomId, sdp }` | WebRTC offer |
| `call:answer` | `{ roomId, sdp }` | WebRTC answer |
| `call:ice-candidate` | `{ roomId, candidate }` | ICE candidate |
| `call:end` | `{ roomId }` | End call |

### Server → All (broadcast to room)
| Event | Payload | Purpose |
|-------|---------|---------|
| `message:new` | Full message object with user info | New message |
| `message:updated` | `{ messageId, content, editedAt }` | Message edited |
| `message:deleted` | `{ messageId }` | Message deleted |
| `message:reaction` | `{ messageId, emoji, userId, action }` | Reaction add/remove |
| `user:typing` | `{ userId, username, roomId, stopped? }` | Someone typing |
| `user:online` | `{ userId, username, status, customStatus?, customStatusEmoji? }` | User came online |
| `user:offline` | `{ userId, username }` | User went offline |
| `user:status` | `{ userId, username, status?, customStatus?, customStatusEmoji? }` | Status changed |
| `message:pinned` | `{ roomId, messageId }` | Message pinned |
| `message:unpinned` | `{ roomId, messageId }` | Message unpinned |
| `call:offer` | `{ userId, username, sdp }` | Incoming call offer |
| `call:answer` | `{ userId, username, sdp }` | Call answered |
| `call:ice-candidate` | `{ userId, candidate }` | ICE candidate |
| `call:end` | `{ userId, roomId }` | Call ended |

## Features

### Included (Phase 1)
- Typing indicators
- Read receipts (last_read_at per room-member)
- Edit/delete messages (soft delete)
- File/image upload (local storage with abstract interface)
- Online/offline presence
- Message reactions
- Pinned messages
- Multiple chat rooms (DM + group)
- Message search (Postgres full-text search)
- Rate limiting (in-memory token bucket, rate limit headers)
- Admin dashboard (minimal server-rendered HTML)
- Docker Compose (app + Postgres)
- WebRTC call signaling
- Message replies (reply_to_id)
- User bio & display name
- Account deletion (soft delete)
- Room topic & icons
- Bulk delete messages
- Health checks (/healthz, /readyz)

### Phase 2
- Session management (token hash, device info, IP, remote logout)
- Presence status (online, idle, dnd, invisible)
- Custom status (text + emoji, broadcast on change)
- Password change (invalidates other sessions)
- @username mentions (parsed on send, dedicated endpoint)
- Search highlighting (hit: true in search results)
- Signed file URLs (HMAC-SHA256 with expiry)
- Config validation at startup
- Username validation (chars, length, reserved names)
- Snowflake ID generator (available, not yet rolled out to tables)

### Phase 3
- Invite links (code, expiry, max-uses, join via invite)

### Skipped for now (need client-side)
- Push notifications
- E2E encryption
- Screenshot detection

## File Uploads (inspired by Spacebar's Storage interface)
- **Now**: `LocalFileStorage` — saves to `uploads/`, served via Hono static
- **Future**: `S3FileStorage` — swap without touching routes
- Max file size: 50MB (configurable via `MAX_FILE_SIZE`)
- Unique filenames: `{timestamp}-{random}{ext}`

## Call Feature (WebRTC)
- Server acts as **signaling relay only** — no media through server
- Clients connect peer-to-peer via WebRTC
- Free Google STUN server: `stun:stun.l.google.com:19302`
- Future: add `coturn` TURN server if NAT traversal fails

## Rate Limiting
- 60 requests/min per IP for REST
- 30 messages/min per user on Socket.IO
- In-memory token bucket (per-IP + per-route key)

## Admin Dashboard
- Minimal server-rendered HTML at `/admin`
- Shows: users list, message list, basic stats
- Protected by same JWT, admin flag from `ADMIN_USERNAME` env var

## Key Implementation Notes

### HTTP Server Architecture (Bun + Hono + Socket.IO)
- DO NOT use `@hono/node-server` — incompatible with Bun 1.3.9
- Instead: manual `http.createServer()` adapter that converts Node.js `IncomingMessage`/`ServerResponse` to Web API `Request`/`Response`:
  1. `http.createServer()` creates the raw Node server
  2. Socket.IO attaches to this server via `new Server(httpServer)`
  3. The request listener converts Node req/res to Fetch API, calls `app.fetch()`, and pipes the response back
  4. `nodeServer.listen()` starts both Hono and Socket.IO on the same port
- See `src/index.ts` for the `toWebHeaders()`, `readBody()`, `writeResponse()` helper functions

### Database Query Format
- `db.execute(sql\`...\`)` with the `postgres` driver returns results as a **flat array** of row objects — NOT `{ rows: [...] }`
- Access: `result[0].column_name` for the first row, NOT `result.rows[0]`
- Example: `const rows = await db.execute(sql\`SELECT ...\`); rows[0].cnt`

### Date Handling in SQL Templates
- Raw `Date` objects cannot be passed directly in `sql` template literals — the postgres driver will throw `TypeError: The "string" argument must be of type string...`
- Always convert to ISO string and cast: `AND created_at > ${date.toISOString()}::timestamptz`

### Admin Route Mounting
- Admin routes are mounted at `/admin` (not at `/`)
- Routes in `src/routes/admin.ts` use relative paths: `/`, `/stats`, `/messages/:id`
- The `authMiddleware` in admin routes only applies to routes starting with `/admin`

### Route Ordering
- Routes are mounted in order: auth → users → rooms → messages → upload → sessions → invites → admin
- The `authMiddleware` is applied per-route file (each sub-router calls `router.use("*", authMiddleware)`)
- Auth routes (`/register`, `/login`) intentionally omit the middleware

### Session Creation
- Sessions are created on every register and login
- Token hash is SHA-256 of the JWT (stored for audit/invalidation)
- Device info comes from User-Agent header, IP from x-forwarded-for
- Password change deletes all existing sessions for the user and issues a new token
- Single-user sessions are listed via `GET /api/sessions` and can be revoked individually

### Signed URLs
- File URLs in message responses are wrapped with `signUrl()` from `lib/signing.ts`
- Signature: `HMAC-SHA256(path:expires, jwt_secret)` — first 16 hex chars
- Default expiry: 1 hour (3600 seconds)
- Clients should treat `file_url` as a signed URL; re-fetch messages if expired

### Mentions Parsing
- On message send, `@username` patterns are extracted from content via regex `/@(\w+)/g`
- Duplicates are deduplicated, then matched against room members only
- Each mention is inserted into `message_mentions` table (idempotent via onConflictDoNothing)
- `GET /api/me/mentions` returns the last 50 mentions with message content and sender info

### @username regex note
- The regex `/@(\w+)/g` matches word characters only; usernames with hyphens (`-`) are not matched
- This is intentional to keep parsing simple; if usernames with hyphens are needed, change to `/@([\w-]+)/g`

## Deployment

### Option 1: Docker Compose (self-host)
```yaml
services:
  app:
    build: .
    ports: ["3000:3000"]
    depends_on:
      db:
        condition: service_healthy
    env_file: .env
    volumes:
      - uploads:/app/uploads
  db:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD:-postgres}
      POSTGRES_DB: ${DB_NAME:-chat}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
volumes:
  pgdata:
  uploads:
```

### Option 2: Fly.io (free tier)
Fly.io gives 3 shared VMs, 1GB PostgreSQL, and 5GB Tigris object storage — all free, no credit card.

#### Prerequisites
```bash
flyctl auth signup        # Create Fly.io account (no CC needed)
flyctl auth login         # Login
```

#### Setup
```bash
# Launch app (creates fly.toml)
flyctl launch --no-deploy

# Provision Postgres
flyctl postgres create --name chat-db --org personal
flyctl postgres attach chat-db

# Provision Tigris S3 storage
flyctl storage create --name chat-uploads --org personal
# This sets S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY in your app secrets
```

#### Environment secrets
```bash
flyctl secrets set \
  JWT_SECRET="$(openssl rand -hex 32)" \
  STORAGE_BACKEND=s3 \
  CORS_ORIGIN="https://your-frontend.fly.dev" \
  ADMIN_USERNAME=admin
```

#### Deploy
```bash
flyctl deploy
```

#### Prevent idle sleep (free VMs sleep after 5 min idle)
```bash
# Use UptimeRobot (free) to ping https://your-app.fly.dev/healthz every 5 minutes
# Or use cron on any always-on machine:
# */5 * * * * curl -sS https://your-app.fly.dev/healthz >/dev/null 2>&1
```

All configuration is env-driven — switch back to self-host by changing env vars, zero code changes.

## Project Structure

```
chat-app/
├── src/
│   ├── index.ts          # Entry — http.createServer + Socket.IO + Hono adapter
│   ├── config.ts         # Env loader (dotenv) + validateConfig()
│   ├── schema.ts         # Drizzle table defs (9 tables: users, rooms, room_members, messages, message_reactions, pinned_messages, sessions, invites, message_mentions)
│   ├── migrate.ts        # SQL migration runner (raw SQL, not Drizzle Kit)
│   ├── lib/
│   │   ├── db.ts         # Drizzle + postgres client
│   │   ├── auth.ts       # JWT sign/verify, bcrypt hash/compare
│   │   ├── errors.ts     # HTTPError class
│   │   ├── io.ts         # Shared Socket.IO reference (setIO/getIO)
│   │   ├── presence.ts   # onlineUsers Set (shared between routes + socket)
│   │   ├── snowflake.ts  # Snowflake ID generator (bigint timestamp-based)
│   │   ├── signing.ts    # HMAC-SHA256 URL signing with expiry
│   │   └── validators.ts # Username/password validation (regex, reserved names)
│   ├── middleware/
│   │   ├── auth.ts       # JWT Bearer token verify middleware
│   │   ├── rate-limit.ts # In-memory token bucket (rate limit headers on all responses)
│   │   └── error-handler.ts # Global error handler (catches HTTPError)
│   ├── routes/
│   │   ├── auth.ts       # POST /register, /login (creates session records)
│   │   ├── users.ts      # GET /me, PATCH /me, DELETE /me, PATCH /me/password, settings, users list, status, mentions
│   │   ├── rooms.ts      # CRUD rooms + members + unread counts (topic, iconUrl)
│   │   ├── sessions.ts   # GET /sessions, DELETE /sessions/:id
│   │   ├── invites.ts    # POST /rooms/:id/invites, GET /invites/:code, POST /invites/:code/join
│   │   ├── messages.ts   # CRUD messages + reactions + pins + FTS search + replies + mentions + signed URLs + bulk delete
│   │   ├── upload.ts     # POST /upload (multipart, uses Storage abstraction)
│   │   └── admin.ts      # GET /admin (HTML), /admin/stats, DELETE /admin/messages/:id
│   ├── socket/
│   │   ├── index.ts      # Socket.IO setup + JWT auth middleware (loads status)
│   │   ├── messages.ts   # Socket message:send handler (DB insert + broadcast)
│   │   ├── calls.ts      # WebRTC signaling relay (call:offer/answer/ice/end)
│   │   ├── typing.ts     # typing:start / typing:stop handlers
│   │   └── presence.ts   # Online/status tracking, status:update handler, user:online broadcasts status
│   └── storage/
│       ├── index.ts      # Storage interface (save/get/delete/exists/getUrl)
│       ├── local.ts      # LocalFileStorage — saves to uploads/, generates unique names
│       └── s3.ts         # S3FileStorage — persists to S3-compatible storage (Tigris, MinIO, R2)
├── tests/
│   └── api.test.ts       # 68 end-to-end tests (REST + Socket.IO)
├── uploads/              # Uploaded files directory
├── docker-compose.yml    # App + Postgres with healthcheck
├── Dockerfile            # Multi-stage Bun build
├── package.json          # Scripts: dev, start, db:migrate
├── tsconfig.json
├── drizzle.config.ts
└── .env.example
```

## Environment Variables
```
PORT=3000
DATABASE_URL=postgres://user:pass@localhost:5432/chat
JWT_SECRET=your-secret-key
ADMIN_USERNAME=admin
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=52428800
RATE_LIMIT_REQUESTS=60
RATE_LIMIT_WINDOW_MS=60000
CORS_ORIGIN=*
STORAGE_BACKEND=local        # "local" or "s3"
S3_ENDPOINT=                 # e.g. https://fly-storage.fly.dev
S3_REGION=auto               # "auto" for Tigris, or actual region
S3_BUCKET=chat-uploads
S3_ACCESS_KEY=
S3_SECRET_KEY=
SHUTDOWN_TIMEOUT_MS=10000
```

## Key Dependencies
- `hono` — HTTP framework (with `hono/bun` for serveStatic)
- `socket.io` — WebSocket (no `@hono/node-server`)
- `drizzle-orm` + `postgres` — DB driver and ORM
- `bcryptjs` — password hashing
- `jsonwebtoken` — JWT signing/verification
- `@aws-sdk/client-s3` — S3-compatible storage SDK (used by S3FileStorage)

## Run Commands
```bash
cp .env.example .env                    # configure environment
docker compose up -d                    # start Postgres
bun src/migrate.ts                      # create tables
bun dev                                 # start dev server with --watch
bun src/index.ts                        # production start
```

## Testing

### Running Tests
```bash
bun test                                # Run full test suite (68 tests)
bun test --timeout 30000                # With extended timeout (default for CI)
```

### Test Architecture
- **Framework**: Bun's built-in test runner (`bun test`)
- **File**: `tests/api.test.ts` — end-to-end integration tests
- **Setup**: Automatically starts Docker Postgres, runs migrations, starts server
- **Teardown**: Kills server, removes Docker container, cleans up uploads
- **Scope**: 68 tests, 151+ assertions covering every REST endpoint + Socket.IO events

### Test Coverage (68 tests)
| Category | Tests | What's tested |
|----------|-------|---------------|
| Auth | 8 | Register validation (short/reserved/invalid chars/password), success, duplicate, login success, wrong password |
| Users | 9 | Profile, bio update, status/custom status, invalid status rejection, user list, status endpoint, settings merge, password change, wrong current password |
| Rooms | 5 | Create group, create DM, list with unread count, details with members, update topic/icon, non-admin member add rejection |
| Invites | 6 | Register charlie, non-admin create reject, admin create, lookup, join via invite, duplicate join reject, invalid code |
| Messages | 7 | Send, @mention parsing, list with reactions/replyTo, reply, search with hit:true, no-match search, pagination, edit own, edit other's rejection |
| Reactions | 4 | Add, idempotent add, verify in GET, remove |
| Pinned | 4 | Pin, list, unpin, verify removed |
| Mentions | 2 | Bob has mention from @bob message, mention includes sender info |
| Sessions | 2 | Created on register, delete |
| Bulk Delete | 2 | Delete messages, verify hidden |
| Account Delete | 2 | Soft-delete, removed from user list |
| Socket.IO | 6 | Valid/invalid token connect, join/leave room, message broadcast, typing indicators, status update |
| Health Checks | 2 | /healthz ok, /readyz with db connected |
| Rate Limit | 1 | X-RateLimit-* headers present |
| Admin | 3 | HTML dashboard, JSON stats, 401 for no token |

### Notes
- Tests use a dedicated Docker Postgres container (`chat_test_suite`) on port 6452
- Server runs on `TEST_PORT` (default 4567) with `test_uploads/` directory
- All tests are sequential (within-file order) to maintain state
- `RATE_LIMIT_REQUESTS=1000` to prevent rate limiting during tests

## Architecture Principles
1. **Backend-first** — all business logic in the server; clients are thin
2. **Language-agnostic API** — REST + WebSocket JSON, any client can implement it
3. **Storage abstraction** — file storage is swappable (local → S3)
4. **Pluggable WebRTC** — signaling is just relay; media server can be added later
5. **Stateless auth + session tracking** — JWT for stateless auth, `sessions` table for audit/remote logout

## Completed Features

### ✅ Phase 1 — Easy (few files, well-understood)
| Feature | How | Why for 2 people |
|---------|-----|------------------|
| **Message replies** | `reply_to_id` column on messages, return `replyTo` in GET | Conversation threading |
| **Profile pictures** | Avatar upload via `/api/upload`, `avatar_url` field on users | Identity |
| **User bio** | `bio` column on users, PATCH /api/me | Profile customization |
| **Account deletion** | `DELETE /api/me` — soft-delete user, leave rooms | Self-service |
| **Room icons** | `icon_url` column on rooms, PATCH /api/rooms/:id | Group chat identity |
| **Room description/topic** | `topic` column on rooms | Room context |
| **Bulk delete messages** | `POST /api/rooms/:id/messages/bulk-delete` | Clear chat quickly |
| **Health checks** | `GET /healthz`, `GET /readyz` | Docker orchestration |
| **Rate limit headers** | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` on 429 | Client-friendly rate limiting |

### ✅ Phase 2 — Medium (several files, more logic)
| Feature | How | Why |
|---------|-----|-----|
| **Session management** | `sessions` table (token hash, device info, IP, last seen); `GET /api/sessions`, `DELETE /api/sessions/:id`; sessions created on register/login | Security — see active logins, remote logout |
| **Presence status** | `status` column on users (online, idle, dnd, invisible); updated via Socket.IO `status:update`; `user:status` broadcast | Richer presence |
| **Custom status** | `custom_status` + `custom_status_emoji` columns; PATCH /api/me; broadcast on `user:online` and `user:status` | Express current mood/activity |
| **Password change** | `PATCH /api/me/password` — verify old, hash new, delete all existing sessions, return new token | Account security |
| **Message mentions** | `@username` parsing on send → `message_mentions` table; `GET /api/me/mentions` endpoint | Get attention |
| **Message search highlighting** | `hit: true` on messages matching FTS query in search results | Better UX |
| **Signed file URLs** | `lib/signing.ts` — HMAC-SHA256 signed URLs with expiry; file_url wrapped in responses | Secure file access |
| **Snowflake IDs** | `lib/snowflake.ts` — generator available for future use | Scalability |
| **Config validation** | `validateConfig()` called at startup; checks PORT, MAX_FILE_SIZE, JWT_SECRET warning | Catch misconfig early |
| **Username validation** | `lib/validators.ts` — regex `^[a-zA-Z0-9_-]{2,32}$`, reserved names, used in register | Data quality |

### ✅ Phase 3 — Started
| Feature | How | Why |
|---------|-----|-----|
| **Invite links** | `invites` table with code, expiry, max-uses; `POST /api/rooms/:id/invites`, `GET /api/invites/:code`, `POST /api/invites/:code/join` | Let people join |

### Phase 3 — Remaining
| Feature | How | Why |
|---------|-----|-----|
| **TOTP 2FA** | 2FA table + enable/disable/verify endpoints + login flow with TOTP code | Real security |
| **Link previews (embeds)** | Background fetch URL metadata (Open Graph), store in `embed_cache` table, attach to messages | Rich link sharing |
| **Email integration** | SMTP config + email verification + password reset flow | Account recovery |
| **Session IP geolocation** | Lookup IP on session create, store city/country (via free geoip or ipdata.co) | Security visibility |
| **Avatar resizing** | Resize uploaded images to standard sizes (32, 64, 128, 256, 512) on upload | Performance |
| **Webhook support** | Incoming webhooks — generate URL, accept POST from external services | Integrations |

### Skipped (Discord-specific or overkill)
Roles & permissions bitfield, guilds server structure, voice states, complex moderation, audit log stubs, polls, slow mode, captcha, friend requests/relationships, channel categories, threads (full implementation)

## Future Client Roadmap
- `chat-client/web/` — Browser client (HTML/JS or React)
- `chat-client/native/` — Desktop (Qt, Tauri)
- `chat-client/android/` — Android (Kotlin)
- `chat-client/ios/` — iOS (Swift)
- `chat-client/cli/` — Terminal (Ratatui)
- TURN server (coturn) if NAT traversal fails
- Push notifications via Web Push API
- E2E encryption (client-side key exchange)
- S3/MinIO for file storage swap
