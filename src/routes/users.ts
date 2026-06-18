import { Hono } from "hono";
import { db, schema } from "../lib/db";
import { authMiddleware, getUserId, getUsername } from "../middleware/auth";
import { hashPassword, verifyPassword, signToken } from "../lib/auth";
import { validatePassword } from "../lib/validators";
import { onlineUsers } from "../lib/presence";
import { eq, isNull, sql } from "drizzle-orm";

const router = new Hono();

router.use("*", authMiddleware);

router.get("/me", async (c) => {
  const userId = getUserId(c);
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user) return c.json({ error: "User not found" }, 404);

  return c.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    status: user.status,
    customStatus: user.customStatus,
    customStatusEmoji: user.customStatusEmoji,
    deletedAt: user.deletedAt,
    settings: JSON.parse(user.settings || "{}"),
    lastSeenAt: user.lastSeenAt,
    createdAt: user.createdAt,
  });
});

router.patch("/me", async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json();

  const updates: Record<string, unknown> = {};
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl;
  if (body.bio !== undefined) updates.bio = body.bio;
  if (body.status !== undefined) {
    const valid = ["online", "idle", "dnd", "invisible"];
    if (!valid.includes(body.status)) {
      return c.json({ error: "Invalid status. Must be one of: " + valid.join(", ") }, 400);
    }
    updates.status = body.status;
  }
  if (body.customStatus !== undefined) updates.customStatus = body.customStatus;
  if (body.customStatusEmoji !== undefined) updates.customStatusEmoji = body.customStatusEmoji;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  const [user] = await db
    .update(schema.users)
    .set(updates)
    .where(eq(schema.users.id, userId))
    .returning();

  return c.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    status: user.status,
    customStatus: user.customStatus,
    customStatusEmoji: user.customStatusEmoji,
  });
});

router.patch("/me/password", async (c) => {
  const userId = getUserId(c);
  const { currentPassword, newPassword } = await c.req.json();

  if (!currentPassword || !newPassword) {
    return c.json({ error: "currentPassword and newPassword are required" }, 400);
  }

  const err = validatePassword(newPassword);
  if (err) return c.json({ error: err }, 400);

  const [user] = await db
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user) return c.json({ error: "User not found" }, 404);

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) return c.json({ error: "Current password is incorrect" }, 403);

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(schema.users)
    .set({ passwordHash })
    .where(eq(schema.users.id, userId));

  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, userId));

  const token = signToken({ userId, username: getUsername(c) });

  return c.json({ success: true, token });
});

router.get("/me/settings", async (c) => {
  const userId = getUserId(c);
  const [user] = await db
    .select({ settings: schema.users.settings })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  return c.json(JSON.parse(user?.settings || "{}"));
});

router.patch("/me/settings", async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json();

  const [user] = await db
    .select({ settings: schema.users.settings })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  const current = JSON.parse(user?.settings || "{}");
  const merged = { ...current, ...body };

  await db
    .update(schema.users)
    .set({ settings: JSON.stringify(merged) })
    .where(eq(schema.users.id, userId));

  return c.json(merged);
});

router.get("/users", async (c) => {
  const rows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
      bio: schema.users.bio,
      status: schema.users.status,
      customStatus: schema.users.customStatus,
      customStatusEmoji: schema.users.customStatusEmoji,
      lastSeenAt: schema.users.lastSeenAt,
    })
    .from(schema.users)
    .where(isNull(schema.users.deletedAt));

  return c.json(rows);
});

router.get("/me/mentions", async (c) => {
  const userId = getUserId(c);

  const mentions = await db.execute(
    sql`SELECT mm.id, mm.message_id, mm.read_at, mm.created_at,
             m.content, m.room_id,
             u.username, u.display_name, u.avatar_url
      FROM message_mentions mm
      JOIN messages m ON m.id = mm.message_id
      LEFT JOIN users u ON u.id = m.user_id
      WHERE mm.user_id = ${userId} AND m.deleted_at IS NULL
      ORDER BY mm.created_at DESC
      LIMIT 50`,
  );

  return c.json(mentions || []);
});

router.delete("/me", async (c) => {
  const userId = getUserId(c);

  await db
    .update(schema.users)
    .set({ deletedAt: new Date() })
    .where(eq(schema.users.id, userId));

  await db
    .delete(schema.roomMembers)
    .where(eq(schema.roomMembers.userId, userId));

  return c.json({ success: true });
});

router.get("/users/:id/status", async (c) => {
  const targetId = parseInt(c.req.param("id"), 10);
  const [user] = await db
    .select({
      lastSeenAt: schema.users.lastSeenAt,
      status: schema.users.status,
      customStatus: schema.users.customStatus,
      customStatusEmoji: schema.users.customStatusEmoji,
    })
    .from(schema.users)
    .where(eq(schema.users.id, targetId))
    .limit(1);

  if (!user) return c.json({ error: "User not found" }, 404);

  const online = onlineUsers.has(targetId);
  return c.json({
    userId: targetId,
    online,
    status: online ? user.status : "offline",
    customStatus: user.customStatus,
    customStatusEmoji: user.customStatusEmoji,
    lastSeenAt: online ? null : user.lastSeenAt,
  });
});

export default router;
