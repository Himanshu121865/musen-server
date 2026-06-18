import postgres from "postgres";
import { config } from "./config";

async function main() {
  const sql = postgres(config.databaseUrl, { max: 1 });

  console.log("Running migrations...");

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      display_name VARCHAR(100),
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      bio TEXT,
      status VARCHAR(20) DEFAULT 'online' NOT NULL CHECK (status IN ('online', 'idle', 'dnd', 'invisible')),
      custom_status TEXT,
      custom_status_emoji VARCHAR(10),
      deleted_at TIMESTAMPTZ,
      settings TEXT DEFAULT '{}',
      last_seen_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      type VARCHAR(10) NOT NULL CHECK (type IN ('dm', 'group')),
      topic TEXT,
      icon_url TEXT,
      created_by INTEGER REFERENCES users(id) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS room_members (
      id SERIAL PRIMARY KEY,
      room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
      role VARCHAR(20) DEFAULT 'member' NOT NULL CHECK (role IN ('admin', 'member')),
      joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      last_read_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      UNIQUE(room_id, user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      content TEXT,
      file_url TEXT,
      file_name TEXT,
      file_size INTEGER,
      file_type VARCHAR(100),
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS messages_room_id_idx ON messages(room_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS messages_content_fts_idx ON messages
    USING GIN (to_tsvector('english', COALESCE(content, '')))
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id SERIAL PRIMARY KEY,
      message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
      emoji VARCHAR(10) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      UNIQUE(message_id, user_id, emoji)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS pinned_messages (
      id SERIAL PRIMARY KEY,
      room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
      message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE NOT NULL,
      pinned_by INTEGER REFERENCES users(id) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      UNIQUE(room_id, message_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
      token_hash TEXT NOT NULL,
      device_info TEXT,
      ip_address VARCHAR(45),
      last_seen_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS message_mentions (
      id SERIAL PRIMARY KEY,
      message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS mentions_message_idx ON message_mentions(message_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS mentions_user_idx ON message_mentions(user_id)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS invites (
      id SERIAL PRIMARY KEY,
      code VARCHAR(16) UNIQUE NOT NULL,
      room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
      created_by INTEGER REFERENCES users(id) NOT NULL,
      max_uses INTEGER DEFAULT 0 NOT NULL,
      use_count INTEGER DEFAULT 0 NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS invites_code_idx ON invites(code)
  `;

  console.log("Migrations complete!");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
