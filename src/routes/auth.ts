import { Hono } from "hono";
import { db, schema } from "../lib/db";
import { hashPassword, verifyPassword, signToken } from "../lib/auth";
import { HTTPError } from "../lib/errors";
import { createHash } from "crypto";
import { validateUsername, validatePassword } from "../lib/validators";
import { eq } from "drizzle-orm";

const router = new Hono();

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function createSession(userId: number, token: string, c: any): Promise<void> {
  await db.insert(schema.sessions).values({
    userId,
    tokenHash: tokenHash(token),
    deviceInfo: c.req.header("user-agent") || null,
    ipAddress: c.req.header("x-forwarded-for") || c.req.header("cf-connecting-ip") || null,
  }).onConflictDoNothing();
}

router.post("/register", async (c) => {
  const { username, password } = await c.req.json();

  const usernameErr = validateUsername(username);
  if (usernameErr) throw new HTTPError(400, usernameErr);
  const passwordErr = validatePassword(password);
  if (passwordErr) throw new HTTPError(400, passwordErr);

  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);

  if (existing.length > 0) {
    throw new HTTPError(409, "Username already taken");
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(schema.users)
    .values({ username, passwordHash })
    .returning();

  const token = signToken({ userId: user.id, username: user.username });
  await createSession(user.id, token, c);
  return c.json(
    {
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    },
    201,
  );
});

router.post("/login", async (c) => {
  const { username, password } = await c.req.json();

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);

  if (!user) {
    throw new HTTPError(401, "Invalid username or password");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new HTTPError(401, "Invalid username or password");
  }

  const token = signToken({ userId: user.id, username: user.username });
  await createSession(user.id, token, c);
  return c.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    },
  });
});

export default router;
