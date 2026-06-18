import { Hono } from "hono";
import { db, schema } from "../lib/db";
import { authMiddleware, getUserId } from "../middleware/auth";
import { HTTPError } from "../lib/errors";
import { eq, and, inArray, sql } from "drizzle-orm";

const router = new Hono();

router.use("*", authMiddleware);

router.get("/rooms", async (c) => {
  const userId = getUserId(c);

  const memberships = await db
    .select({
      roomId: schema.roomMembers.roomId,
      role: schema.roomMembers.role,
      lastReadAt: schema.roomMembers.lastReadAt,
    })
    .from(schema.roomMembers)
    .where(eq(schema.roomMembers.userId, userId));

  if (memberships.length === 0) return c.json([]);

  const roomIds = memberships.map((m) => m.roomId);
  const rooms = await db
    .select()
    .from(schema.rooms)
    .where(inArray(schema.rooms.id, roomIds));

  const unreadCounts: Record<number, number> = {};
  for (const m of memberships) {
    const lt = typeof m.lastReadAt === "string" ? m.lastReadAt : (m.lastReadAt as Date).toISOString();
    const result: any = await db.execute(
      sql`SELECT COUNT(*)::int as cnt FROM messages
       WHERE room_id = ${m.roomId} AND deleted_at IS NULL
       AND created_at > ${lt}::timestamptz`,
    );
    unreadCounts[m.roomId] = Number(result[0]?.cnt ?? 0);
  }

  const result = rooms.map((room) => {
    const membership = memberships.find((m) => m.roomId === room.id)!;
    return {
      ...room,
      role: membership.role,
      unreadCount: unreadCounts[room.id] || 0,
    };
  });

  return c.json(result);
});

router.post("/rooms", async (c) => {
  const userId = getUserId(c);
  const { name, type, memberIds } = await c.req.json();

  if (!name) throw new HTTPError(400, "Room name is required");
  if (type !== "dm" && type !== "group") {
    throw new HTTPError(400, "Type must be 'dm' or 'group'");
  }

  if (type === "dm") {
    const otherUserId = memberIds?.[0];
    if (!otherUserId) throw new HTTPError(400, "DM requires one other user");

    const existing = await db
      .select({ roomId: schema.roomMembers.roomId })
      .from(schema.roomMembers)
      .where(eq(schema.roomMembers.userId, userId));

    if (existing.length > 0) {
      const existingRoomIds = existing.map((e) => e.roomId);
      const theirMemberships = await db
        .select({ roomId: schema.roomMembers.roomId })
        .from(schema.roomMembers)
        .where(
          and(
            eq(schema.roomMembers.userId, otherUserId),
            inArray(schema.roomMembers.roomId, existingRoomIds),
          ),
        );

      for (const m of theirMemberships) {
        const [room] = await db
          .select()
          .from(schema.rooms)
          .where(
            and(
              eq(schema.rooms.id, m.roomId),
              eq(schema.rooms.type, "dm"),
            ),
          )
          .limit(1);

        if (room) {
          const result = await db
            .select({ count: sql<number>`count(*)` })
            .from(schema.roomMembers)
            .where(eq(schema.roomMembers.roomId, room.id));

          if (Number(result[0]?.count ?? 0) === 2) {
            return c.json(room);
          }
        }
      }
    }
  }

  const [room] = await db
    .insert(schema.rooms)
    .values({ name, type, createdBy: userId })
    .returning();

  const allMemberIds = [userId, ...(memberIds || [])];
  for (const mid of allMemberIds) {
    await db
      .insert(schema.roomMembers)
      .values({ roomId: room.id, userId: mid, role: mid === userId ? "admin" : "member" })
      .onConflictDoNothing();
  }

  return c.json(room, 201);
});

router.get("/rooms/:id", async (c) => {
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

  const [room] = await db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.id, roomId))
    .limit(1);

  const members = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
      role: schema.roomMembers.role,
      lastReadAt: schema.roomMembers.lastReadAt,
    })
    .from(schema.roomMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.roomMembers.userId))
    .where(eq(schema.roomMembers.roomId, roomId));

  return c.json({ ...room, members });
});

router.patch("/rooms/:id", async (c) => {
  const userId = getUserId(c);
  const roomId = parseInt(c.req.param("id"), 10);
  const body = await c.req.json();

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

  if (!membership || membership.role !== "admin") {
    throw new HTTPError(403, "Only admins can update room");
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.topic !== undefined) updates.topic = body.topic;
  if (body.iconUrl !== undefined) updates.iconUrl = body.iconUrl;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  const [room] = await db
    .update(schema.rooms)
    .set(updates)
    .where(eq(schema.rooms.id, roomId))
    .returning();

  return c.json(room);
});

router.post("/rooms/:id/members", async (c) => {
  const userId = getUserId(c);
  const roomId = parseInt(c.req.param("id"), 10);
  const { userId: newUserId } = await c.req.json();

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

  if (!membership || membership.role !== "admin") {
    throw new HTTPError(403, "Only admins can add members");
  }

  const [member] = await db
    .insert(schema.roomMembers)
    .values({ roomId, userId: newUserId, role: "member" })
    .onConflictDoNothing()
    .returning();

  return c.json(member, 201);
});

router.delete("/rooms/:id/members/:userId", async (c) => {
  const userId = getUserId(c);
  const roomId = parseInt(c.req.param("id"), 10);
  const targetUserId = parseInt(c.req.param("userId"), 10);

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

  if (!membership || membership.role !== "admin") {
    throw new HTTPError(403, "Only admins can remove members");
  }

  await db
    .delete(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, roomId),
        eq(schema.roomMembers.userId, targetUserId),
      ),
    );

  return c.json({ success: true });
});

export default router;
