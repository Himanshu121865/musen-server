import type { Context, Next } from "hono";
import { config } from "../config";
import { HTTPError } from "../lib/errors";

const buckets = new Map<string, { count: number; resetAt: number }>();

function setRateLimitHeaders(c: Context, remaining: number, resetAt: number) {
  c.header("X-RateLimit-Limit", String(config.rateLimitRequests));
  c.header("X-RateLimit-Remaining", String(remaining));
  c.header("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
}

export function rateLimitMiddleware(c: Context, next: Next) {
  const ip = c.req.header("x-forwarded-for") || c.req.header("cf-connecting-ip") || "unknown";
  const now = Date.now();
  const key = `${ip}:${c.req.routePath}`;

  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + config.rateLimitWindowMs };
    buckets.set(key, bucket);
  }

  bucket.count++;
  const remaining = Math.max(0, config.rateLimitRequests - bucket.count);
  setRateLimitHeaders(c, remaining, bucket.resetAt);

  if (bucket.count > config.rateLimitRequests) {
    c.header("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
    throw new HTTPError(429, "Too many requests");
  }

  return next();
}
