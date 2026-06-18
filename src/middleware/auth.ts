import type { Context, Next } from "hono";
import { verifyToken } from "../lib/auth";
import { HTTPError } from "../lib/errors";

export async function authMiddleware(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HTTPError(401, "Missing or invalid authorization header");
  }

  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    c.set("userId", payload.userId);
    c.set("username", payload.username);
    await next();
  } catch {
    throw new HTTPError(401, "Invalid or expired token");
  }
}

export function getUserId(c: Context): number {
  return c.get("userId") as number;
}

export function getUsername(c: Context): string {
  return c.get("username") as string;
}
