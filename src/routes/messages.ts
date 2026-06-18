import { Hono } from "hono";
import { db, schema } from "../lib/db";
import { authMiddleware, getUserId, getUsername } from "../middleware/auth";
import { HTTPError } from "../lib/errors";
import { getIO } from "../lib/io";
import { signUrl } from "../lib/signing";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";

const router = new Hono();

router.use("*", authMiddleware);

router.get("/rooms/:id/messages", async (c) => {
  const userId = getUserId(c);
  const roomId = parseInt(c.req.param("id"), 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const before = c.req.query("before");
  const q = c.req.query("q");

  const [membership] = await db
    .select()
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, roomId),
        eq(schema.roomMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) throw new HTTPError(403, "Not a member of this room");

  let rows: any;
  if (q) {
    rows = await db.execute(
      sql`SELECT m.*, u.username, u.display_name, u.avatar_url
       FROM messages m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.room_id = ${roomId} AND m.deleted_at IS NULL
       AND to_tsvector('english', COALESCE(m.content, '')) @@ plainto_tsquery('english', ${q})
       ORDER BY m.created_at DESC
       LIMIT ${limit}`,
    );
  } else if (before) {
    rows = await db.execute(
      sql`SELECT m.*, u.username, u.display_name, u.avatar_url
       FROM messages m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.room_id = ${roomId} AND m.deleted_at IS NULL AND m.id < ${before}
       ORDER BY m.created_at DESC
       LIMIT ${limit}`,
    );
  } else {
    rows = await db.execute(
      sql`SELECT m.*, u.username, u.display_name, u.avatar_url
       FROM messages m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.room_id = ${roomId} AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC
       LIMIT ${limit}`,
    );
  }

  const isSearch = !!q;
  const messages = rows as any[] || [];

  for (const msg of messages) {
    if (isSearch) msg.hit = true;
    if (msg.file_url) msg.file_url = signUrl(msg.file_url);

    const reactions = await db
      .select({
        emoji: schema.messageReactions.emoji,
        userId: schema.messageReactions.userId,
      })
      .from(schema.messageReactions)
      .where(eq(schema.messageReactions.messageId, msg.id));
    msg.reactions = reactions;

    if (msg.reply_to_id) {
      const [parent] = await db.execute(
        sql`SELECT m.id, m.content, m.created_at, u.username, u.display_name, u.avatar_url
         FROM messages m
         LEFT JOIN users u ON u.id = m.user_id
         WHERE m.id = ${msg.reply_to_id}`,
      );
      if (parent) {
        msg.replyTo = parent;
      }
    }
  }

  return c.json(messages.reverse());
});

router.post("/rooms/:id/messages", async (c) => {
  const userId = getUserId(c);
  const username = getUsername(c);
  const roomId = parseInt(c.req.param("id"), 10);
  const { content, fileUrl, fileName, fileSize, fileType, replyToId } =
    await c.req.json();

  const [membership] = await db
    .select()
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, roomId),
        eq(schema.roomMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) throw new HTTPError(403, "Not a member of this room");

  if (replyToId !== undefined) {
    const [parent] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, replyToId))
      .limit(1);
    if (!parent || parent.roomId !== roomId) {
      throw new HTTPError(400, "Invalid reply target");
    }
  }

  const [msg] = await db
    .insert(schema.messages)
    .values({
      roomId,
      userId,
      replyToId: replyToId || null,
      content: content || null,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      fileSize: fileSize || null,
      fileType: fileType || null,
    })
    .returning();

  let result: any = { ...msg, username, displayName: null, avatarUrl: null };
  if (userId) {
    const [user] = await db
      .select({
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (user) {
      result = { ...result, ...user };
    }
  }

  if (result.replyToId) {
    const [parent] = await db.execute(
      sql`SELECT m.id, m.content, m.created_at, u.username, u.display_name, u.avatar_url
       FROM messages m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.id = ${result.replyToId}`,
    );
    if (parent) {
      result.replyTo = parent;
    }
  }

  if (result.fileUrl) {
    result.fileUrl = signUrl(result.fileUrl);
  }

  if (content) {
    const mentioned = content.match(/@(\w+)/g);
    if (mentioned) {
      const usernames = [...new Set(mentioned.map((m: string) => m.slice(1)))];
      const roomMembers = await db
        .select({ userId: schema.roomMembers.userId })
        .from(schema.roomMembers)
        .where(eq(schema.roomMembers.roomId, roomId));

      const memberIds = roomMembers.map((m) => m.userId);
      if (memberIds.length > 0) {
        const targets = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(inArray(schema.users.username, usernames as string[]), inArray(schema.users.id, memberIds)));

        for (const target of targets) {
          await db.insert(schema.messageMentions)
            .values({ messageId: msg.id, userId: target.id })
            .onConflictDoNothing();
        }
      }
    }
  }

  getIO().to(`room:${roomId}`).emit("message:new", result);
  return c.json(result, 201);
});

router.patch("/messages/:id", async (c) => {
  const userId = getUserId(c);
  const messageId = parseInt(c.req.param("id"), 10);
  const { content } = await c.req.json();

  const [msg] = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.id, messageId))
    .limit(1);

  if (!msg) throw new HTTPError(404, "Message not found");
  if (msg.userId !== userId) throw new HTTPError(403, "Not your message");

  const [updated] = await db
    .update(schema.messages)
    .set({ content, editedAt: new Date() })
    .where(eq(schema.messages.id, messageId))
    .returning();

  getIO().to(`room:${msg.roomId}`).emit("message:updated", {
    messageId: updated.id,
    content: updated.content,
    editedAt: updated.editedAt,
  });

  return c.json(updated);
});

router.delete("/messages/:id", async (c) => {
  const userId = getUserId(c);
  const messageId = parseInt(c.req.param("id"), 10);

  const [msg] = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.id, messageId))
    .limit(1);

  if (!msg) throw new HTTPError(404, "Message not found");
  if (msg.userId !== userId) throw new HTTPError(403, "Not your message");

  await db
    .update(schema.messages)
    .set({ deletedAt: new Date() })
    .where(eq(schema.messages.id, messageId));

  getIO().to(`room:${msg.roomId}`).emit("message:deleted", { messageId });

  return c.json({ success: true });
});

router.post("/messages/:id/reactions", async (c) => {
  const userId = getUserId(c);
  const messageId = parseInt(c.req.param("id"), 10);
  const { emoji } = await c.req.json();

  const [msg] = await db
    .select({ roomId: schema.messages.roomId })
    .from(schema.messages)
    .where(eq(schema.messages.id, messageId))
    .limit(1);

  if (!msg) throw new HTTPError(404, "Message not found");

  await db
    .insert(schema.messageReactions)
    .values({ messageId, userId, emoji })
    .onConflictDoNothing();

  getIO().to(`room:${msg.roomId}`).emit("message:reaction", {
    messageId,
    emoji,
    userId,
    action: "add",
  });

  return c.json({ success: true }, 201);
});

router.delete("/messages/:id/reactions/:emoji", async (c) => {
  const userId = getUserId(c);
  const messageId = parseInt(c.req.param("id"), 10);
  const emoji = c.req.param("emoji");

  const [msg] = await db
    .select({ roomId: schema.messages.roomId })
    .from(schema.messages)
    .where(eq(schema.messages.id, messageId))
    .limit(1);

  if (!msg) throw new HTTPError(404, "Message not found");

  await db
    .delete(schema.messageReactions)
    .where(
      and(
        eq(schema.messageReactions.messageId, messageId),
        eq(schema.messageReactions.userId, userId),
        eq(schema.messageReactions.emoji, emoji),
      ),
    );

  getIO().to(`room:${msg.roomId}`).emit("message:reaction", {
    messageId,
    emoji,
    userId,
    action: "remove",
  });

  return c.json({ success: true });
});

router.post("/rooms/:id/pin/:messageId", async (c) => {
  const userId = getUserId(c);
  const roomId = parseInt(c.req.param("id"), 10);
  const messageId = parseInt(c.req.param("messageId"), 10);

  const [membership] = await db
    .select()
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, roomId),
        eq(schema.roomMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) throw new HTTPError(403, "Not a member of this room");

  await db
    .insert(schema.pinnedMessages)
    .values({ roomId, messageId, pinnedBy: userId })
    .onConflictDoNothing();

  getIO().to(`room:${roomId}`).emit("message:pinned", { roomId, messageId });

  return c.json({ success: true }, 201);
});

router.delete("/rooms/:id/pin/:messageId", async (c) => {
  const userId = getUserId(c);
  const roomId = parseInt(c.req.param("id"), 10);
  const messageId = parseInt(c.req.param("messageId"), 10);

  const [membership] = await db
    .select()
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, roomId),
        eq(schema.roomMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) throw new HTTPError(403, "Not a member of this room");

  await db
    .delete(schema.pinnedMessages)
    .where(
      and(
        eq(schema.pinnedMessages.roomId, roomId),
        eq(schema.pinnedMessages.messageId, messageId),
      ),
    );

  getIO().to(`room:${roomId}`).emit("message:unpinned", { roomId, messageId });

  return c.json({ success: true });
});

router.get("/rooms/:id/pinned", async (c) => {
  const userId = getUserId(c);
  const roomId = parseInt(c.req.param("id"), 10);

  const [membership] = await db
    .select()
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, roomId),
        eq(schema.roomMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) throw new HTTPError(403, "Not a member of this room");

  const pinned = await db
    .select({
      id: schema.pinnedMessages.id,
      messageId: schema.pinnedMessages.messageId,
      pinnedBy: schema.pinnedMessages.pinnedBy,
      createdAt: schema.pinnedMessages.createdAt,
    })
    .from(schema.pinnedMessages)
    .where(eq(schema.pinnedMessages.roomId, roomId));

  return c.json(pinned);
});

router.post("/rooms/:id/messages/bulk-delete", async (c) => {
  const userId = getUserId(c);
  const roomId = parseInt(c.req.param("id"), 10);
  const { messageIds } = await c.req.json();

  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    throw new HTTPError(400, "messageIds must be a non-empty array");
  }

  const [membership] = await db
    .select()
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, roomId),
        eq(schema.roomMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) throw new HTTPError(403, "Not a member of this room");

  await db
    .update(schema.messages)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.messages.roomId, roomId),
        eq(schema.messages.userId, userId),
        inArray(schema.messages.id, messageIds),
        isNull(schema.messages.deletedAt),
      ),
    );

  for (const messageId of messageIds) {
    getIO().to(`room:${roomId}`).emit("message:deleted", { messageId });
  }

  return c.json({ success: true });
});

export default router;
