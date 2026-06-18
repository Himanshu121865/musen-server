import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: varchar("username", { length: 50 }).unique().notNull(),
    displayName: varchar("display_name", { length: 100 }),
    passwordHash: text("password_hash").notNull(),
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    status: varchar("status", { length: 20 }).$type<"online" | "idle" | "dnd" | "invisible">().default("online").notNull(),
    customStatus: text("custom_status"),
    customStatusEmoji: varchar("custom_status_emoji", { length: 10 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    settings: text("settings").$default(() => "{}"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    usernameIdx: uniqueIndex("users_username_idx").on(table.username),
  }),
);

export const rooms = pgTable("rooms", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  type: varchar("type", { length: 10 }).$type<"dm" | "group">().notNull(),
  topic: text("topic"),
  iconUrl: text("icon_url"),
  createdBy: integer("created_by")
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const roomMembers = pgTable(
  "room_members",
  {
    id: serial("id").primaryKey(),
    roomId: integer("room_id")
      .references(() => rooms.id, { onDelete: "cascade" })
      .notNull(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: varchar("role", { length: 20 })
      .$type<"admin" | "member">()
      .default("member")
      .notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    roomUserIdx: uniqueIndex("room_members_room_user_idx").on(
      table.roomId,
      table.userId,
    ),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    roomId: integer("room_id")
      .references(() => rooms.id, { onDelete: "cascade" })
      .notNull(),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    replyToId: integer("reply_to_id"),
    content: text("content"),
    fileUrl: text("file_url"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    fileType: varchar("file_type", { length: 100 }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    roomIdIdx: index("messages_room_id_idx").on(table.roomId),
    ftsIdx: index("messages_content_fts_idx").using(
      "gin",
      sql`to_tsvector('english', "content")`,
    ),
  }),
);

export const messageReactions = pgTable(
  "message_reactions",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .references(() => messages.id, { onDelete: "cascade" })
      .notNull(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    emoji: varchar("emoji", { length: 10 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    messageUserEmojiIdx: uniqueIndex("reactions_message_user_emoji_idx").on(
      table.messageId,
      table.userId,
      table.emoji,
    ),
  }),
);

export const pinnedMessages = pgTable(
  "pinned_messages",
  {
    id: serial("id").primaryKey(),
    roomId: integer("room_id")
      .references(() => rooms.id, { onDelete: "cascade" })
      .notNull(),
    messageId: integer("message_id")
      .references(() => messages.id, { onDelete: "cascade" })
      .notNull(),
    pinnedBy: integer("pinned_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    roomMessageIdx: uniqueIndex("pinned_room_message_idx").on(
      table.roomId,
      table.messageId,
    ),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tokenHash: text("token_hash").notNull(),
    deviceInfo: text("device_info"),
    ipAddress: varchar("ip_address", { length: 45 }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    sessionsUserIdIdx: index("sessions_user_id_idx").on(table.userId),
  }),
);

export const messageMentions = pgTable(
  "message_mentions",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .references(() => messages.id, { onDelete: "cascade" })
      .notNull(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    mentionsMessageIdx: index("mentions_message_idx").on(table.messageId),
    mentionsUserIdx: index("mentions_user_idx").on(table.userId),
  }),
);

export const invites = pgTable(
  "invites",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 16 }).unique().notNull(),
    roomId: integer("room_id")
      .references(() => rooms.id, { onDelete: "cascade" })
      .notNull(),
    createdBy: integer("created_by")
      .references(() => users.id)
      .notNull(),
    maxUses: integer("max_uses").default(0).notNull(),
    useCount: integer("use_count").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    codeIdx: uniqueIndex("invites_code_idx").on(table.code),
  }),
);
