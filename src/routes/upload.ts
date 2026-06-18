import { Hono } from "hono";
import { authMiddleware, getUserId } from "../middleware/auth";
import { HTTPError } from "../lib/errors";
import { createStorage } from "../storage/index";
import { config } from "../config";

const router = new Hono();

router.use("*", authMiddleware);

const storage = createStorage();

router.post("/upload", async (c) => {
  const userId = getUserId(c);
  if (!userId) throw new HTTPError(401, "Unauthorized");

  const body = await c.req.parseBody();
  const file = body["file"] as File | undefined;

  if (!file) throw new HTTPError(400, "No file provided");

  if (file.size > config.maxFileSize) {
    throw new HTTPError(413, "File too large (max 50MB)");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = await storage.save(file.name, buffer);

  return c.json({
    url: storage.getUrl(filename),
    name: file.name,
    size: file.size,
    type: file.type,
  });
});

export default router;
