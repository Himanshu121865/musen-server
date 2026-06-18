import { createHmac, timingSafeEqual } from "crypto";
import { config } from "../config";

export function signUrl(path: string, expiresInSeconds = 3600): string {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const data = `${path}:${expires}`;
  const sig = createHmac("sha256", config.jwtSecret)
    .update(data)
    .digest("hex")
    .slice(0, 16);
  return `${path}?expires=${expires}&sig=${sig}`;
}

export function verifySignedUrl(path: string, expires: string, sig: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (parseInt(expires, 10) < now) return false;
  const data = `${path}:${expires}`;
  const expected = createHmac("sha256", config.jwtSecret)
    .update(data)
    .digest("hex")
    .slice(0, 16);
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
