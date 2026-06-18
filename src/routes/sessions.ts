import { Hono } from "hono";
import { db, schema } from "../lib/db";
import { authMiddleware, getUserId } from "../middleware/auth";
import { eq } from "drizzle-orm";

const router = new Hono();

router.use("*", authMiddleware);

router.get("/sessions", async (c) => {
  const userId = getUserId(c);

  const rows = await db
    .select({
      id: schema.sessions.id,
      userId: schema.sessions.userId,
      deviceInfo: schema.sessions.deviceInfo,
      ipAddress: schema.sessions.ipAddress,
      lastSeenAt: schema.sessions.lastSeenAt,
      createdAt: schema.sessions.createdAt,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .orderBy(schema.sessions.lastSeenAt);

  return c.json(rows);
});

router.delete("/sessions/:id", async (c) => {
  const userId = getUserId(c);
  const sessionId = parseInt(c.req.param("id"), 10);

  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!session || session.userId !== userId) {
    return c.json({ error: "Session not found" }, 404);
  }

  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.id, sessionId));

  return c.json({ success: true });
});

export default router;
