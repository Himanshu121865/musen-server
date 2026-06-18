import { Hono } from "hono";
import { db, schema } from "../lib/db";
import { authMiddleware, getUserId } from "../middleware/auth";
import { HTTPError } from "../lib/errors";
import { eq, and, sql } from "drizzle-orm";
import { randomBytes } from "crypto";

const router = new Hono();

function generateCode(): string {
  return randomBytes(8).toString("base64url").slice(0, 12);
}

router.use("*", authMiddleware);

router.post("/rooms/:id/invites", async (c) => {
  const userId = getUserId(c);
  const roomId = parseInt(c.req.param("id"), 10);
  const { maxUses, expiresInHours } = await c.req.json();

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
    throw new HTTPError(403, "Only admins can create invites");
  }

  const code = generateCode();
  const expiresAt = new Date(
    Date.now() + (expiresInHours || 24) * 3600 * 1000,
  );

  const [invite] = await db
    .insert(schema.invites)
    .values({
      code,
      roomId,
      createdBy: userId,
      maxUses: maxUses || 0,
      expiresAt,
    })
    .returning();

  return c.json(invite, 201);
});

router.get("/invites/:code", async (c) => {
  const code = c.req.param("code");

  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.code, code))
    .limit(1);

  if (!invite) throw new HTTPError(404, "Invite not found");

  const now = new Date();
  if (invite.expiresAt < now) throw new HTTPError(410, "Invite has expired");

  if (invite.maxUses > 0 && invite.useCount >= invite.maxUses) {
    throw new HTTPError(410, "Invite has reached max uses");
  }

  const [room] = await db
    .select({
      id: schema.rooms.id,
      name: schema.rooms.name,
      type: schema.rooms.type,
      topic: schema.rooms.topic,
    })
    .from(schema.rooms)
    .where(eq(schema.rooms.id, invite.roomId))
    .limit(1);

  const [creator] = await db
    .select({ username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.id, invite.createdBy))
    .limit(1);

  return c.json({
    code: invite.code,
    room,
    createdBy: creator?.username || "unknown",
    maxUses: invite.maxUses,
    useCount: invite.useCount,
    expiresAt: invite.expiresAt,
  });
});

router.post("/invites/:code/join", async (c) => {
  const userId = getUserId(c);
  const code = c.req.param("code");

  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.code, code))
    .limit(1);

  if (!invite) throw new HTTPError(404, "Invite not found");

  const now = new Date();
  if (invite.expiresAt < now) throw new HTTPError(410, "Invite has expired");

  if (invite.maxUses > 0 && invite.useCount >= invite.maxUses) {
    throw new HTTPError(410, "Invite has reached max uses");
  }

  const [existing] = await db
    .select()
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, invite.roomId),
        eq(schema.roomMembers.userId, userId),
      ),
    )
    .limit(1);

  if (existing) {
    return c.json({ error: "Already a member of this room" }, 409);
  }

  await db.insert(schema.roomMembers).values({
    roomId: invite.roomId,
    userId,
    role: "member",
  });

  await db
    .update(schema.invites)
    .set({ useCount: sql`use_count + 1` })
    .where(eq(schema.invites.id, invite.id));

  const [room] = await db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.id, invite.roomId))
    .limit(1);

  return c.json(room, 201);
});

export default router;
