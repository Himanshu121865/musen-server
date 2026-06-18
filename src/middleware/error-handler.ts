import type { Context } from "hono";
import { HTTPError } from "../lib/errors";

export function errorHandler(err: Error, c: Context) {
  if (err instanceof HTTPError) {
    return c.json({ error: err.message }, err.status as any);
  }

  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500 as any);
}
