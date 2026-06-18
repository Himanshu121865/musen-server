# Chat App API

Private chat backend for 2+ people. Bun + Hono + Socket.IO + PostgreSQL. REST API + real-time WebSocket messaging.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Bun |
| Framework | Hono |
| Real-time | Socket.IO |
| Database | PostgreSQL 16 |
| ORM | Drizzle |
| Auth | bcrypt JWT (HS256, self-managed) |
| File storage | Local disk or S3-compatible (env switch) |

## Quick Start

```bash
cp .env.example .env
docker compose up -d --build
bun src/migrate.ts
# Server at http://localhost:3000
```

## Authentication

**Flow:** Register → get JWT → pass JWT in `Authorization: Bearer <token>` header.

- Passwords hashed with bcrypt before storage
- JWTs signed with HS256 using `JWT_SECRET` env var
- Sessions table tracks each login (token hash, device info, IP, last seen)
- Every `POST /api/register` and `POST /api/login` creates a session record
- All REST endpoints require JWT except register/login
- Socket.IO handshake passes token as `auth: { token }`

### POST /api/register

```
Request:  { "username": "alice", "password": "secret123" }
Response: { "token": "eyJ...", "user": { "id": 1, "username": "alice", ... } }
```

### POST /api/login

```
Request:  { "username": "alice", "password": "secret123" }
Response: { "token": "eyJ...", "user": { "id": 1, "username": "alice", ... } }
```

**Validation:**
- Username: 2-32 chars, `^[a-zA-Z0-9_-]+$`, no reserved names (admin, root, system, etc.)
- Password: 6-128 chars

## REST API Reference

All endpoints return JSON. Errors return `{ "error": "message" }` with appropriate HTTP status.

### Global Error Codes

| Status | Meaning |
|--------|---------|
| 400 | Bad request (missing/invalid fields) |
| 401 | Unauthorized (missing/invalid JWT) |
| 403 | Forbidden (not admin / not room member) |
| 404 | Resource not found |
| 409 | Conflict (duplicate username, already member) |
| 413 | File too large |
| 429 | Rate limited |
| 500 | Internal server error |

---

### Users

`GET /api/me` — Get authenticated user's profile

```
Response: {
  "id": 1,
  "username": "alice",
  "displayName": "Alice",
  "avatarUrl": "/uploads/abc.jpg",
  "bio": "Hello!",
  "status": "online",
  "customStatus": "coding",
  "customStatusEmoji": "💻",
  "deletedAt": null,
  "settings": {},
  "lastSeenAt": "2026-06-17T19:00:00.000Z",
  "createdAt": "2026-06-17T18:00:00.000Z"
}
```

`PATCH /api/me` — Update profile fields (partial, send only changed fields)

```
Request: { "displayName": "New Name", "bio": "Updated bio", "avatarUrl": "/uploads/new.jpg", "status": "dnd", "customStatus": "busy", "customStatusEmoji": "🚫" }
Response: (updated user object)
```

Status values: `online`, `idle`, `dnd`, `invisible`

`DELETE /api/me` — Soft-delete account (sets `deleted_at`, removes from rooms)

```
Response: { "message": "Account deleted" }
```

`PATCH /api/me/password` — Change password (invalidates all other sessions)

```
Request:  { "currentPassword": "old", "newPassword": "new123" }
Response: { "token": "eyJ...", "message": "Password changed" }
```

`GET /api/me/settings` — Get user settings

```
Response: { "settings": { "theme": "dark", "notifications": true } }
```

`PATCH /api/me/settings` — Update settings (deep merge)

```
Request: { "theme": "light" }
Response: { "settings": { "theme": "light", "notifications": true } }
```

`GET /api/me/mentions` — Get last 50 @mentions

```
Response: [
  {
    "messageId": 10,
    "content": "Hello @alice!",
    "senderId": 2,
    "senderUsername": "bob",
    "roomId": 1,
    "roomName": "general",
    "readAt": null,
    "createdAt": "2026-06-17T19:00:00.000Z"
  }
]
```

`GET /api/users` — List all non-deleted users

```
Response: [
  { "id": 1, "username": "alice", "displayName": "Alice", "avatarUrl": null, "status": "online", "customStatus": null, "customStatusEmoji": null }
]
```

`GET /api/users/:id/status` — Get a user's presence

```
Response: { "userId": 1, "username": "alice", "online": true, "status": "online", "customStatus": null, "customStatusEmoji": null, "lastSeenAt": "..." }
```

---

### Sessions

`GET /api/sessions` — List authenticated user's sessions

```
Response: [
  { "id": 1, "deviceInfo": "Mozilla/5.0 ...", "ipAddress": "192.168.1.1", "lastSeenAt": "...", "createdAt": "..." }
]
```

`DELETE /api/sessions/:id` — Revoke a session (remote logout)

```
Response: { "message": "Session revoked" }
```

---

### Rooms

`GET /api/rooms` — List rooms the user is a member of (with unread counts)

```
Response: [
  {
    "id": 1,
    "name": "general",
    "type": "group",
    "topic": "Chat about stuff",
    "iconUrl": null,
    "createdBy": 1,
    "createdAt": "...",
    "unreadCount": 3,
    "lastMessage": { "id": 10, "content": "Hey!", "createdAt": "...", "username": "bob" }
  }
]
```

`POST /api/rooms` — Create a room

```
Request:  { "name": "my-room", "type": "group", "memberIds": [2, 3] }
Response: { "id": 2, "name": "my-room", "type": "group", "createdBy": 1, ... }
```

- `type` can be `"dm"` (no `memberIds` needed — auto-creates 2-person room) or `"group"`
- The creator is automatically added as `admin`

`GET /api/rooms/:id` — Get room details with members

```
Response: {
  "id": 1,
  "name": "general",
  "type": "group",
  "topic": "Chat about stuff",
  "iconUrl": null,
  "createdBy": 1,
  "createdAt": "...",
  "members": [
    { "userId": 1, "username": "alice", "role": "admin", "joinedAt": "..." },
    { "userId": 2, "username": "bob", "role": "member", "joinedAt": "..." }
  ]
}
```

`PATCH /api/rooms/:id` — Update room

```
Request:  { "name": "new-name", "topic": "New topic", "iconUrl": "/uploads/icon.jpg" }
Response: (updated room object)
```

`POST /api/rooms/:id/members` — Add member (admin only)

```
Request:  { "userId": 2 }
Response: { "message": "Member added" }
```

`DELETE /api/rooms/:id/members/:userId` — Remove member (admin only)

```
Response: { "message": "Member removed" }
```

---

### Messages

`GET /api/rooms/:id/messages?q=&limit=50&before=<messageId>` — Get messages

- `q` — full-text search query (Postgres `to_tsvector` / `plainto_tsquery`)
- `limit` — max results (default 50)
- `before` — cursor pagination (get messages older than this ID)

```
Response: [
  {
    "id": 10,
    "roomId": 1,
    "userId": 1,
    "username": "alice",
    "content": "Hello @bob!",
    "replyToId": null,
    "replyTo": null,
    "fileUrl": null,
    "fileName": null,
    "fileSize": null,
    "fileType": null,
    "editedAt": null,
    "deletedAt": null,
    "createdAt": "...",
    "reactions": [],
    "hit": true
  }
]
```

- `hit: true` means the message matched the search query
- `fileUrl` is an HMAC-signed URL (expires in 1 hour by default)
- `replyTo` contains the full referenced message object when `replyToId` is set

`POST /api/rooms/:id/messages` — Send a message

```
Request:  { "content": "Hello world!", "replyToId": 5 }
Response: (full message object)
```

- `content` is optional (file-only messages are valid)
- `replyToId` references another message in the same room
- `@username` patterns in content are parsed and stored in `message_mentions` table
- Mentions are only tracked for room members

`POST /api/rooms/:id/messages/bulk-delete` — Bulk soft-delete own messages

```
Request:  { "messageIds": [1, 2, 3] }
Response: { "message": "Messages deleted" }
```

`PATCH /api/messages/:id` — Edit message (owner only)

```
Request:  { "content": "Updated content" }
Response: (updated message object with editedAt set)
```

`DELETE /api/messages/:id` — Soft-delete message (owner only)

```
Response: { "message": "Message deleted" }
```

`POST /api/messages/:id/reactions` — Add reaction

```
Request:  { "emoji": "👍" }
Response: { "message": "Reaction added" }
```

`DELETE /api/messages/:id/reactions/:emoji` — Remove reaction

```
Response: { "message": "Reaction removed" }
```

`POST /api/rooms/:id/pin/:messageId` — Pin a message (admin only)

```
Response: { "message": "Message pinned" }
```

`DELETE /api/rooms/:id/pin/:messageId` — Unpin a message

```
Response: { "message": "Message unpinned" }
```

`GET /api/rooms/:id/pinned` — List pinned messages

```
Response: [ (array of full message objects with user info) ]
```

---

### Invites

`POST /api/rooms/:id/invites` — Create invite link (room admin only)

```
Request:  { "maxUses": 5, "expiresInHours": 48 }
Response: { "code": "abc123def456", "roomId": 1, "maxUses": 5, "expiresAt": "..." }
```

- `maxUses`: 0 = unlimited
- `expiresInHours`: defaults to 24 if omitted

`GET /api/invites/:code` — Lookup invite info

```
Response: {
  "code": "abc123def456",
  "roomId": 1,
  "roomName": "general",
  "roomIconUrl": null,
  "maxUses": 5,
  "useCount": 2,
  "expiresAt": "...",
  "createdAt": "..."
}
```

`POST /api/invites/:code/join` — Join room via invite

```
Response: { "roomId": 1, "roomName": "general" }
```

- Returns 403 if invite is expired or max uses reached
- Returns 409 if already a member

---

### Files

`POST /api/upload` — Upload a file (multipart/form-data)

```
Field: "file" (the file data)
Response: { "url": "/uploads/1712345678-a1b2c3d4.jpg", "name": "photo.jpg", "size": 12345, "type": "image/jpeg" }
```

- Max file size: 50MB (configurable via `MAX_FILE_SIZE`)
- Storage backend chosen by `STORAGE_BACKEND` env var (`local` or `s3`)
- Unique filenames: `{timestamp}-{random}{ext}`

---

### Health Checks

`GET /healthz` — Liveness probe (no auth)

```
Response: { "status": "ok" }
```

`GET /readyz` — Readiness probe (no auth, checks DB)

```
Response: { "status": "ok", "db": "connected" }        # 200
Response: { "status": "error", "db": "disconnected" }   # 503
```

---

### Admin

Admin routes mounted at `/admin`. `ADMIN_USERNAME` env var determines admin user.

`GET /admin` — Server-rendered HTML dashboard

`GET /admin/stats` — JSON stats

```
Response: { "users": 5, "rooms": 3, "messages": 120 }
```

`DELETE /admin/messages/:id` — Admin delete any message (hard delete)

```
Response: { "message": "Message deleted by admin" }
```

---

### Root Endpoint

`GET /` — API info

```
Response: {
  "name": "Chat App API",
  "version": "0.1.0",
  "endpoints": {
    "auth": { "register": "POST /api/register", "login": "POST /api/login" },
    "docs": "See AGENTS.md for full API reference"
  }
}
```

---

## Socket.IO Events

Connect to the same port as the HTTP server. Pass JWT in handshake:

```js
const socket = io("http://localhost:3000", {
  auth: { token: "eyJ..." }
});
```

### Client → Server

| Event | Payload | Notes |
|-------|---------|-------|
| `join:room` | `{ roomId }` | Subscribe to room events |
| `leave:room` | `{ roomId }` | Unsubscribe from room |
| `message:send` | `{ roomId, content?, fileUrl?, fileName?, fileSize?, fileType?, replyToId? }` | Send a message (content optional for file-only) |
| `message:edit` | `{ messageId, content }` | Edit own message |
| `message:delete` | `{ messageId }` | Delete own message |
| `message:react` | `{ messageId, emoji }` | Toggle reaction |
| `typing:start` | `{ roomId }` | Start typing indicator |
| `typing:stop` | `{ roomId }` | Stop typing indicator |
| `status:update` | `{ status?, customStatus?, customStatusEmoji? }` | Update presence |
| `read:receipt` | `{ roomId, lastReadMessageId }` | Mark room as read |
| `call:offer` | `{ roomId, sdp }` | WebRTC offer |
| `call:answer` | `{ roomId, sdp }` | WebRTC answer |
| `call:ice-candidate` | `{ roomId, candidate }` | ICE candidate |
| `call:end` | `{ roomId }` | End call |

### Server → Client (broadcast to room)

| Event | Payload | Notes |
|-------|---------|-------|
| `message:new` | Full message object with user info | New message in room |
| `message:updated` | `{ messageId, content, editedAt }` | Message edited |
| `message:deleted` | `{ messageId }` | Message deleted |
| `message:reaction` | `{ messageId, emoji, userId, action }` | Reaction added/removed |
| `user:typing` | `{ userId, username, roomId, stopped? }` | Typing indicator |
| `user:online` | `{ userId, username, status, customStatus?, customStatusEmoji? }` | User connected |
| `user:offline` | `{ userId, username }` | User disconnected |
| `user:status` | `{ userId, username, status?, customStatus?, customStatusEmoji? }` | Status changed |
| `message:pinned` | `{ roomId, messageId }` | Message pinned |
| `message:unpinned` | `{ roomId, messageId }` | Message unpinned |
| `call:offer` | `{ userId, username, sdp }` | Incoming call |
| `call:answer` | `{ userId, username, sdp }` | Call answered |
| `call:ice-candidate` | `{ userId, candidate }` | ICE candidate relay |
| `call:end` | `{ userId, roomId }` | Call ended |

### Rate Limits (Socket.IO)

- 30 messages/min per user for `message:send`
- Disconnected socket receives `error` event with `{ message: "Rate limit exceeded" }`

---

## Database Schema (9 tables)

### users

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| username | VARCHAR(50) UNIQUE | `^[a-zA-Z0-9_-]{2,32}$` |
| display_name | VARCHAR(100) | nullable |
| password_hash | TEXT | bcrypt |
| avatar_url | TEXT | nullable |
| bio | TEXT | nullable |
| status | VARCHAR(20) | online, idle, dnd, invisible |
| custom_status | TEXT | nullable |
| custom_status_emoji | VARCHAR(10) | nullable |
| deleted_at | TIMESTAMPTZ | nullable (soft delete) |
| settings | TEXT | JSON string |
| last_seen_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

### rooms

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| name | VARCHAR(100) | |
| type | VARCHAR(10) | dm or group |
| topic | TEXT | nullable |
| icon_url | TEXT | nullable |
| created_by | INT → users.id | |
| created_at | TIMESTAMPTZ | |

### room_members

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| room_id | INT → rooms.id CASCADE | |
| user_id | INT → users.id CASCADE | |
| role | VARCHAR(20) | admin or member |
| joined_at | TIMESTAMPTZ | |
| last_read_at | TIMESTAMPTZ | read receipts |
| UNIQUE(room_id, user_id) | | |

### messages

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| room_id | INT → rooms.id CASCADE | |
| user_id | INT → users.id SET NULL | |
| reply_to_id | INT → messages.id | nullable |
| content | TEXT | nullable (file-only) |
| file_url | TEXT | signed URL in responses |
| file_name | TEXT | nullable |
| file_size | INTEGER | nullable |
| file_type | VARCHAR(100) | nullable |
| edited_at | TIMESTAMPTZ | nullable |
| deleted_at | TIMESTAMPTZ | nullable |
| created_at | TIMESTAMPTZ | |
| GIN index | `to_tsvector('english', content)` | full-text search |

### message_reactions

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| message_id | INT → messages.id CASCADE | |
| user_id | INT → users.id CASCADE | |
| emoji | VARCHAR(10) | |
| created_at | TIMESTAMPTZ | |
| UNIQUE(message_id, user_id, emoji) | | |

### pinned_messages

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| room_id | INT → rooms.id CASCADE | |
| message_id | INT → messages.id CASCADE | |
| pinned_by | INT → users.id | |
| created_at | TIMESTAMPTZ | |
| UNIQUE(room_id, message_id) | | |

### sessions

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| user_id | INT → users.id CASCADE | |
| token_hash | TEXT | SHA-256 of JWT |
| device_info | TEXT | User-Agent |
| ip_address | VARCHAR(45) | IPv6-capable |
| last_seen_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

### invites

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| code | VARCHAR(16) UNIQUE | base64url (12 chars) |
| room_id | INT → rooms.id CASCADE | |
| created_by | INT → users.id | |
| max_uses | INTEGER | 0 = unlimited |
| use_count | INTEGER | incremented per join |
| expires_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

### message_mentions

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| message_id | INT → messages.id CASCADE | |
| user_id | INT → users.id CASCADE | |
| read_at | TIMESTAMPTZ | nullable |
| created_at | TIMESTAMPTZ | |

---

## Key Implementation Details

### HTTP Server Architecture

Uses a raw `http.createServer()` adapter (not `@hono/node-server`, which is incompatible with Bun). The adapter converts Node.js `IncomingMessage`/`ServerResponse` to Web API `Request`/`Response`, calls `app.fetch()`, and pipes the response back. Socket.IO attaches to the same `http.Server`, so HTTP and WebSocket share a single port.

### Database Query Pattern

`db.execute(sql\`...\`)` returns a flat array of row objects — NOT `{ rows: [...] }`. Access results directly: `result[0].column_name`.

### Date Handling

Raw `Date` objects cannot be passed in `sql` template literals. Always convert: `${date.toISOString()}::timestamptz`.

### Signed File URLs

File URLs in message responses are HMAC-SHA256 signed with the `JWT_SECRET`. Format: `{path}:{expiry_timestamp}:{signature}`. Default expiry: 1 hour. Clients should treat `file_url` as potentially expired and re-fetch messages if needed.

### Mentions Parsing

`@username` is parsed via regex `/@(\w+)/g` on message send. Only matches word characters (no hyphens). Deduplicated, then matched against room members only. Stored in `message_mentions` table via `onConflictDoNothing`.

### Rate Limiting

- **REST**: 60 requests/min per IP (token bucket per route)
- **Socket.IO**: 30 messages/min per user
- Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- 429 responses include `Retry-After` header

### File Uploads

- Storage backend selected by `STORAGE_BACKEND=local|s3`
- `LocalFileStorage` saves to `UPLOAD_DIR` (default `./uploads`), served via Hono `serveStatic`
- `S3FileStorage` uses `@aws-sdk/client-s3`; compatible with Tigris, MinIO, Cloudflare R2, Backblaze B2
- Max file size: configurable via `MAX_FILE_SIZE` (default 50MB)
- Unique filenames: `{timestamp}-{random}{ext}`

### WebRTC Calls

Server acts as signaling relay only. No media passes through the server — clients connect peer-to-peer. Recommended STUN: `stun:stun.l.google.com:19302`. A TURN server (coturn) can be added later.

### Graceful Shutdown

On `SIGTERM`:
1. Disconnect all Socket.IO clients
2. Close Socket.IO server
3. Close HTTP server (stop accepting new connections)
4. Close PostgreSQL connection pool
5. Force exit after `SHUTDOWN_TIMEOUT_MS` (default 10s)

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | HTTP server port |
| DATABASE_URL | postgres://postgres:postgres@localhost:5432/chat | PostgreSQL connection string |
| JWT_SECRET | (dev default) | HMAC key for JWT (REQUIRED, must change for production) |
| ADMIN_USERNAME | admin | Username with admin privileges |
| UPLOAD_DIR | ./uploads | Directory for local file storage |
| MAX_FILE_SIZE | 52428800 | Max upload size in bytes (default 50MB) |
| RATE_LIMIT_REQUESTS | 60 | REST requests per window |
| RATE_LIMIT_WINDOW_MS | 60000 | Rate limit window in ms |
| CORS_ORIGIN | * | Comma-separated origins or `*` |
| STORAGE_BACKEND | local | `local` or `s3` |
| S3_ENDPOINT | — | S3 endpoint URL (required when STORAGE_BACKEND=s3) |
| S3_REGION | auto | S3 region (`auto` for Tigris) |
| S3_BUCKET | chat-uploads | S3 bucket name |
| S3_ACCESS_KEY | — | S3 access key |
| S3_SECRET_KEY | — | S3 secret key |
| SHUTDOWN_TIMEOUT_MS | 10000 | Max wait for graceful shutdown (ms) |

---

## Project Structure

```
chat-server/
├── src/
│   ├── index.ts            # Entry point
│   ├── config.ts           # Env config + validation
│   ├── schema.ts           # Drizzle schema (9 tables)
│   ├── migrate.ts          # Migration runner
│   ├── lib/                # Shared utilities (auth, db, errors, io, presence, signing, validators, snowflake)
│   ├── middleware/          # Auth, rate-limit, error-handler
│   ├── routes/             # Route handlers (auth, users, rooms, messages, upload, sessions, invites, admin)
│   ├── socket/             # Socket.IO handlers (messages, calls, typing, presence)
│   └── storage/            # Storage interface + local/s3 implementations
├── tests/
│   └── api.test.ts         # 68 end-to-end tests
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

## Full Feature List

### REST Endpoints (24 unique paths)

- Auth: register, login
- Users: profile (GET/PATCH/DELETE), password, settings (GET/PATCH), mentions, user list, user status
- Sessions: list, revoke
- Rooms: list, create, details, update, add member, remove member
- Messages: list (with search), send, bulk-delete, edit, delete, react, unreact, pin, unpin, pinned list
- Invites: create, lookup, join
- Files: upload
- Health: liveness, readiness
- Admin: dashboard (HTML), stats, delete message

### Socket.IO Events (27 events)

- Room: join, leave
- Messages: send, edit, delete, react
- Typing: start, stop
- Presence: status update, read receipt
- Broadcasts: new message, updated, deleted, reaction, typing, online, offline, status, pin, unpin
- WebRTC: offer, answer, ice-candidate, end

### Data Features

- Full-text search (Postgres GIN index)
- Message replies (reply_to_id)
- @mentions with read tracking
- Custom presence (online, idle, dnd, invisible) + custom status text/emoji
- File uploads (local disk or S3-compatible storage)
- Signed file URLs (HMAC-SHA256 with expiry)
- Message reactions (per-user per-emoji unique)
- Pinned messages (one per room)
- Session management (list active sessions, remote logout)
- Invite links (code, expiry, max-uses)
- Bulk message deletion
- Soft account deletion
- Read receipts (per-room last_read_at)
- Rate limiting with response headers
- Config validation at startup
- Username validation (regex + reserved names)
- Graceful shutdown (drain connections, close DB)
- CORS configurable via env var
