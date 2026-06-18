import "dotenv/config";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { serveStatic } from "hono/bun";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { sql } from "drizzle-orm";
import { config, validateConfig } from "./config";
import { db, queryClient } from "./lib/db";
import { setIO, getIO } from "./lib/io";
import { errorHandler } from "./middleware/error-handler";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { createSocketServer } from "./socket/index";
import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import roomsRoutes from "./routes/rooms";
import messagesRoutes from "./routes/messages";
import uploadRoutes from "./routes/upload";
import adminRoutes from "./routes/admin";
import sessionsRoutes from "./routes/sessions";
import invitesRoutes from "./routes/invites";

type Variables = {
  userId: number;
  username: string;
};

const app = new Hono<{ Variables: Variables }>();

const corsOrigin = config.corsOrigin === "*" ? "*" : config.corsOrigin.split(",").map((s) => s.trim());
app.use("*", cors({ origin: corsOrigin, credentials: true }));
app.use("*", logger());
app.use("/api/*", rateLimitMiddleware);
app.onError(errorHandler);

app.route("/api", authRoutes);
app.route("/api", usersRoutes);
app.route("/api", roomsRoutes);
app.route("/api", messagesRoutes);
app.route("/api", uploadRoutes);
app.route("/api", sessionsRoutes);
app.route("/api", invitesRoutes);
app.route("/admin", adminRoutes);

app.use("/uploads/*", serveStatic({ root: "./uploads" }));

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.get("/readyz", async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ok", db: "connected" });
  } catch {
    return c.json({ status: "error", db: "disconnected" }, 503);
  }
});

app.get("/", (c) => {
  return c.json({
    name: "Chat App API",
    version: "0.1.0",
    endpoints: {
      auth: { register: "POST /api/register", login: "POST /api/login" },
      docs: "See AGENTS.md for full API reference",
    },
  });
});

function toWebHeaders(nodeHeaders: IncomingMessage["headers"]): Headers {
  const h = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value === undefined) continue;
    h.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return h;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function writeResponse(res: ServerResponse, response: Response): void {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (response.body) {
    const reader = response.body.getReader();
    function pump(): void {
      reader.read().then(({ done, value }) => {
        if (done) { res.end(); return; }
        res.write(value);
        pump();
      }).catch(() => res.end());
    }
    pump();
  } else {
    res.end();
  }
}

const nodeServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const headers = toWebHeaders(req.headers);
    const body = req.method !== "GET" && req.method !== "HEAD"
      ? await readBody(req)
      : undefined;

    const request = new Request(url, {
      method: req.method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
    });

    const response = await app.fetch(request);
    writeResponse(res, response);
  } catch (err) {
    console.error("Request error:", err);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
});

validateConfig();

const io = createSocketServer(nodeServer);
setIO(io);

nodeServer.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log("WebSocket ready");
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received — starting graceful shutdown...");
  const timeout = setTimeout(() => {
    console.error("Forced exit after timeout");
    process.exit(1);
  }, config.shutdownTimeoutMs);

  try {
    getIO().disconnectSockets(true);
    getIO().close();
    console.log("Socket.IO connections drained");

    nodeServer.close();
    console.log("HTTP server closed");

    await queryClient.end();
    console.log("Database pool closed");

    clearTimeout(timeout);
    process.exit(0);
  } catch (err) {
    console.error("Shutdown error:", err);
    process.exit(1);
  }
});
