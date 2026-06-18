import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { io as SocketIOClient } from "socket.io-client";
import { spawn, execSync } from "child_process";

const PORT = parseInt(process.env.TEST_PORT || "4567", 10);
const BASE = `http://localhost:${PORT}`;
const DB_PORT = 6452;
const DB_URL = `postgres://postgres:postgres@localhost:${DB_PORT}/chat_test`;

let serverProcess: any = null;
let token1 = "";
let token2 = "";
let userId1 = 0;
let userId2 = 0;
let roomId = 0;
let msgId = 0;
let msgId2 = 0;
let pinnedMsgId = 0;

function fetchJson(path: string, opts: any = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  return fetch(`${BASE}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function json(path: string, opts: any = {}) {
  const res = await fetchJson(path, opts);
  const body = await res.json();
  return { status: res.status, body, headers: res.headers };
}

beforeAll(async () => {
  execSync(
    `docker rm -f chat_test_suite 2>/dev/null; ` +
    `docker run -d --name chat_test_suite -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=chat_test -p ${DB_PORT}:5432 postgres:16-alpine`,
    { stdio: "pipe" },
  );
  await new Promise((r) => setTimeout(r, 3000));

  const migrate = Bun.spawnSync(["bun", "src/migrate.ts"], {
    env: { ...process.env, DATABASE_URL: DB_URL },
    cwd: process.cwd(),
  });
  if (migrate.exitCode !== 0) {
    console.error("Migration failed:", migrate.stderr.toString());
    throw new Error("Migration failed");
  }

  serverProcess = Bun.spawn(["bun", "src/index.ts"], {
    env: {
      ...process.env,
      DATABASE_URL: DB_URL,
      JWT_SECRET: "test-secret-suite",
      ADMIN_USERNAME: "alice",
      PORT: String(PORT),
      UPLOAD_DIR: "./test_uploads",
      RATE_LIMIT_REQUESTS: "1000",
    },
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) break;
    } catch {}
  }
}, 30000);

afterAll(() => {
  serverProcess?.kill();
  execSync("docker rm -f chat_test_suite 2>/dev/null", { stdio: "pipe" });
  execSync("rm -rf ./test_uploads", { stdio: "pipe" });
});

describe("Auth", () => {
  test("register with short username fails", async () => {
    const { status, body } = await json("/api/register", {
      method: "POST",
      body: { username: "a", password: "pass1234" },
    });
    expect(status).toBe(400);
    expect(body.error).toBe("Username must be at least 2 characters");
  });

  test("register with reserved username fails", async () => {
    const { status, body } = await json("/api/register", {
      method: "POST",
      body: { username: "admin", password: "pass1234" },
    });
    expect(status).toBe(400);
    expect(body.error).toBe("That username is reserved");
  });

  test("register with invalid chars fails", async () => {
    const { status, body } = await json("/api/register", {
      method: "POST",
      body: { username: "bad user!", password: "pass1234" },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/Username can only contain/);
  });

  test("register with short password fails", async () => {
    const { status, body } = await json("/api/register", {
      method: "POST",
      body: { username: "testuser", password: "ab" },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/Password must be at least/);
  });

  test("register alice succeeds", async () => {
    const { status, body } = await json("/api/register", {
      method: "POST",
      body: { username: "alice", password: "pass1234" },
    });
    expect(status).toBe(201);
    expect(body.token).toBeString();
    expect(body.user.username).toBe("alice");
    token1 = body.token;
    userId1 = body.user.id;
  });

  test("register bob succeeds", async () => {
    const { status, body } = await json("/api/register", {
      method: "POST",
      body: { username: "bob", password: "pass1234" },
    });
    expect(status).toBe(201);
    expect(body.token).toBeString();
    token2 = body.token;
    userId2 = body.user.id;
  });

  test("duplicate username fails", async () => {
    const { status, body } = await json("/api/register", {
      method: "POST",
      body: { username: "alice", password: "pass1234" },
    });
    expect(status).toBe(409);
    expect(body.error).toBe("Username already taken");
  });

  test("login succeeds", async () => {
    const { status, body } = await json("/api/login", {
      method: "POST",
      body: { username: "alice", password: "pass1234" },
    });
    expect(status).toBe(200);
    expect(body.token).toBeString();
    token1 = body.token;
  });

  test("login wrong password fails", async () => {
    const { status, body } = await json("/api/login", {
      method: "POST",
      body: { username: "alice", password: "wrongpass" },
    });
    expect(status).toBe(401);
  });
});

describe("Users", () => {
  test("GET /me returns profile", async () => {
    const { status, body } = await json("/api/me", { token: token1 });
    expect(status).toBe(200);
    expect(body.username).toBe("alice");
    expect(body.status).toBe("online");
    expect(body).toHaveProperty("bio");
    expect(body).toHaveProperty("customStatus");
    expect(body).toHaveProperty("customStatusEmoji");
    expect(body).toHaveProperty("settings");
  });

  test("PATCH /me updates bio", async () => {
    const { status, body } = await json("/api/me", {
      method: "PATCH",
      token: token1,
      body: { bio: "Hello world!" },
    });
    expect(status).toBe(200);
    expect(body.bio).toBe("Hello world!");
  });

  test("PATCH /me updates status", async () => {
    const { status, body } = await json("/api/me", {
      method: "PATCH",
      token: token1,
      body: { status: "idle", customStatus: "Busy", customStatusEmoji: "💼" },
    });
    expect(status).toBe(200);
    expect(body.status).toBe("idle");
    expect(body.customStatus).toBe("Busy");
    expect(body.customStatusEmoji).toBe("💼");
  });

  test("PATCH /me rejects invalid status", async () => {
    const { status, body } = await json("/api/me", {
      method: "PATCH",
      token: token1,
      body: { status: "invalid" },
    });
    expect(status).toBe(400);
  });

  test("GET /users lists all users with status", async () => {
    const { status, body } = await json("/api/users", { token: token1 });
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(2);
    const bob = body.find((u: any) => u.username === "bob");
    expect(bob).toBeDefined();
    expect(bob).toHaveProperty("status", "online");
    expect(bob).toHaveProperty("customStatus");
  });

  test("GET /users/:id/status returns presence", async () => {
    const { status, body } = await json(`/api/users/${userId1}/status`, { token: token1 });
    expect(status).toBe(200);
    expect(body.userId).toBe(userId1);
    expect(body).toHaveProperty("online");
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("customStatus");
    expect(body).toHaveProperty("customStatusEmoji");
  });

  test("PATCH /me/settings merges correctly", async () => {
    const { status, body } = await json("/api/me/settings", {
      method: "PATCH",
      token: token1,
      body: { theme: "dark", lang: "en" },
    });
    expect(status).toBe(200);
    expect(body.theme).toBe("dark");
    expect(body.lang).toBe("en");

    const { body: got } = await json("/api/me/settings", { token: token1 });
    expect(got.theme).toBe("dark");
    expect(got.lang).toBe("en");
  });

  test("PATCH /me/password changes password", async () => {
    const { status, body } = await json("/api/me/password", {
      method: "PATCH",
      token: token1,
      body: { currentPassword: "pass1234", newPassword: "newpass5678" },
    });
    expect(status).toBe(200);
    expect(body.token).toBeString();
    token1 = body.token;

    const { status: s2 } = await json("/api/login", {
      method: "POST",
      body: { username: "alice", password: "newpass5678" },
    });
    expect(s2).toBe(200);
  });

  test("PATCH /me/password wrong current fails", async () => {
    const { status } = await json("/api/me/password", {
      method: "PATCH",
      token: token1,
      body: { currentPassword: "wrong", newPassword: "newerpass" },
    });
    expect(status).toBe(403);
  });
});

describe("Rooms", () => {
  test("create group room", async () => {
    const { status, body } = await json("/api/rooms", {
      method: "POST",
      token: token1,
      body: { name: "general", type: "group", memberIds: [userId2] },
    });
    expect(status).toBe(201);
    expect(body.name).toBe("general");
    expect(body.type).toBe("group");
    roomId = body.id;
  });

  test("create DM room", async () => {
    const { status, body } = await json("/api/rooms", {
      method: "POST",
      token: token1,
      body: { name: "direct", type: "dm", memberIds: [userId2] },
    });
    expect(status).toBe(201);
    expect(body.type).toBe("dm");
  });

  test("GET /rooms lists rooms with unread count", async () => {
    const { status, body } = await json("/api/rooms", { token: token1 });
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]).toHaveProperty("unreadCount");
  });

  test("GET /rooms/:id returns room with members", async () => {
    const { status, body } = await json(`/api/rooms/${roomId}`, { token: token1 });
    expect(status).toBe(200);
    expect(body.id).toBe(roomId);
    expect(body.members.length).toBe(2);
    expect(body).toHaveProperty("topic");
    expect(body).toHaveProperty("iconUrl");
  });

  test("PATCH /rooms/:id updates topic and iconUrl", async () => {
    const { status, body } = await json(`/api/rooms/${roomId}`, {
      method: "PATCH",
      token: token1,
      body: { topic: "General discussion", iconUrl: "https://example.com/icon.png" },
    });
    expect(status).toBe(200);
    expect(body.topic).toBe("General discussion");
    expect(body.iconUrl).toBe("https://example.com/icon.png");
  });

  test("non-admin cannot add members", async () => {
    const { status } = await json(`/api/rooms/${roomId}/members`, {
      method: "POST",
      token: token2,
      body: { userId: userId1 },
    });
    expect(status).toBe(403);
  });
});

describe("Invites", () => {
  let inviteCode = "";
  let token3 = "";

  test("register charlie for invite test", async () => {
    const { body } = await json("/api/register", {
      method: "POST",
      body: { username: "charlie", password: "pass1234" },
    });
    expect(body.token).toBeString();
    token3 = body.token;
  });

  test("non-admin cannot create invite", async () => {
    const { status } = await json(`/api/rooms/${roomId}/invites`, {
      method: "POST",
      token: token2,
      body: {},
    });
    expect(status).toBe(403);
  });

  test("admin creates invite", async () => {
    const { status, body } = await json(`/api/rooms/${roomId}/invites`, {
      method: "POST",
      token: token1,
      body: { maxUses: 5, expiresInHours: 48 },
    });
    expect(status).toBe(201);
    expect(body.code).toBeString();
    expect(body.code.length).toBeGreaterThanOrEqual(8);
    expect(body.maxUses).toBe(5);
    expect(body.useCount).toBe(0);
    inviteCode = body.code;
  });

  test("lookup invite returns room info", async () => {
    const { status, body } = await json(`/api/invites/${inviteCode}`, { token: token3 });
    expect(status).toBe(200);
    expect(body.code).toBe(inviteCode);
    expect(body.room.name).toBe("general");
    expect(body.room.type).toBe("group");
  });

  test("join via invite adds user to room", async () => {
    const { status, body } = await json(`/api/invites/${inviteCode}/join`, {
      method: "POST",
      token: token3,
    });
    expect(status).toBe(201);
    expect(body.name).toBe("general");

    const { body: room } = await json(`/api/rooms/${roomId}`, { token: token3 });
    expect(room.members.length).toBe(3);
  });

  test("cannot join same room twice", async () => {
    const { status } = await json(`/api/invites/${inviteCode}/join`, {
      method: "POST",
      token: token3,
    });
    expect(status).toBe(409);
  });

  test("invalid code returns 404", async () => {
    const { status } = await json("/api/invites/nonexistent123", { token: token1 });
    expect(status).toBe(404);
  });
});

describe("Messages", () => {
  test("send message", async () => {
    const { status, body } = await json(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      token: token1,
      body: { content: "Hello everyone!" },
    });
    expect(status).toBe(201);
    expect(body.content).toBe("Hello everyone!");
    expect(body.username).toBe("alice");
    msgId = body.id;
  });

  test("send message with @mention", async () => {
    const { status, body } = await json(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      token: token1,
      body: { content: "Hey @bob check this!" },
    });
    expect(status).toBe(201);
    msgId2 = body.id;
  });

  test("GET /messages returns messages with replyTo and reactions", async () => {
    const { status, body } = await json(`/api/rooms/${roomId}/messages`, { token: token1 });
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(2);
    expect(body[0]).toHaveProperty("reactions");
    expect(body[0]).toHaveProperty("username");
  });

  test("send reply message", async () => {
    const { status, body } = await json(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      token: token2,
      body: { content: "Thanks!", replyToId: msgId },
    });
    expect(status).toBe(201);
    expect(body.replyToId).toBe(msgId);
    expect(body).toHaveProperty("replyTo");
  });

  test("search messages returns hit: true", async () => {
    const { status, body } = await json(`/api/rooms/${roomId}/messages?q=hello`, { token: token1 });
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body.some((m: any) => m.hit === true)).toBe(true);
  });

  test("search with no matches returns empty", async () => {
    const { status, body } = await json(`/api/rooms/${roomId}/messages?q=xyznonexistent`, { token: token1 });
    expect(status).toBe(200);
    expect(body.length).toBe(0);
  });

  test("pagination with before parameter", async () => {
    const { status, body } = await json(`/api/rooms/${roomId}/messages?before=${msgId2}`, { token: token1 });
    expect(status).toBe(200);
  });

  test("edit own message", async () => {
    const { status, body } = await json(`/api/messages/${msgId}`, {
      method: "PATCH",
      token: token1,
      body: { content: "Hello everyone! (edited)" },
    });
    expect(status).toBe(200);
    expect(body.content).toBe("Hello everyone! (edited)");
    expect(body.editedAt).not.toBeNull();
  });

  test("cannot edit other's message", async () => {
    const { status } = await json(`/api/messages/${msgId}`, {
      method: "PATCH",
      token: token2,
      body: { content: "hacked!" },
    });
    expect(status).toBe(403);
  });
});

describe("Reactions", () => {
  test("add reaction", async () => {
    const { status } = await json(`/api/messages/${msgId}/reactions`, {
      method: "POST",
      token: token1,
      body: { emoji: "👍" },
    });
    expect(status).toBe(201);
  });

  test("add same reaction again (idempotent)", async () => {
    const { status } = await json(`/api/messages/${msgId}/reactions`, {
      method: "POST",
      token: token1,
      body: { emoji: "👍" },
    });
    expect(status).toBe(201);
  });

  test("reaction appears in message", async () => {
    const { body } = await json(`/api/rooms/${roomId}/messages`, { token: token1 });
    const msg = body.find((m: any) => m.id === msgId);
    expect(msg.reactions.length).toBeGreaterThanOrEqual(1);
    expect(msg.reactions.some((r: any) => r.emoji === "👍")).toBe(true);
  });

  test("remove reaction", async () => {
    const { status } = await json(`/api/messages/${msgId}/reactions/👍`, {
      method: "DELETE",
      token: token1,
    });
    expect(status).toBe(200);
  });
});

describe("Pinned Messages", () => {
  test("pin message", async () => {
    const { status } = await json(`/api/rooms/${roomId}/pin/${msgId}`, {
      method: "POST",
      token: token1,
    });
    expect(status).toBe(201);
    pinnedMsgId = msgId;
  });

  test("list pinned messages", async () => {
    const { status, body } = await json(`/api/rooms/${roomId}/pinned`, { token: token1 });
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body.some((p: any) => p.messageId === pinnedMsgId)).toBe(true);
  });

  test("unpin message", async () => {
    const { status } = await json(`/api/rooms/${roomId}/pin/${msgId}`, {
      method: "DELETE",
      token: token1,
    });
    expect(status).toBe(200);
  });

  test("pinned count is zero after unpin", async () => {
    const { body } = await json(`/api/rooms/${roomId}/pinned`, { token: token1 });
    expect(body.filter((p: any) => p.messageId === pinnedMsgId).length).toBe(0);
  });
});

describe("Mentions", () => {
  test("bob has mention from alice's message", async () => {
    const { status, body } = await json("/api/me/mentions", { token: token2 });
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body.some((m: any) => m.content?.includes("@bob"))).toBe(true);
  });

  test("mention includes sender info", async () => {
    const { body } = await json("/api/me/mentions", { token: token2 });
    const mention = body[0];
    expect(mention).toHaveProperty("username");
    expect(mention).toHaveProperty("room_id");
  });
});

describe("Sessions", () => {
  test("sessions created on register", async () => {
    const { status, body } = await json("/api/sessions", { token: token1 });
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]).toHaveProperty("deviceInfo");
    expect(body[0]).toHaveProperty("ipAddress");
  });

  test("delete session", async () => {
    const { body: sessions } = await json("/api/sessions", { token: token1 });
    const sessId = sessions[0]?.id;
    expect(sessId).toBeGreaterThan(0);

    const { status } = await json(`/api/sessions/${sessId}`, {
      method: "DELETE",
      token: token1,
    });
    expect(status).toBe(200);
  });
});

describe("Bulk Delete", () => {
  test("bulk delete messages", async () => {
    const { status, body } = await json(`/api/rooms/${roomId}/messages/bulk-delete`, {
      method: "POST",
      token: token1,
      body: { messageIds: [msgId, msgId2] },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("deleted messages hidden from list", async () => {
    const { body } = await json(`/api/rooms/${roomId}/messages`, { token: token1 });
    const deleted = body.filter((m: any) => m.id === msgId || m.id === msgId2);
    expect(deleted.length).toBe(0);
  });
});

describe("Account Deletion", () => {
  test("DELETE /me soft-deletes account", async () => {
    const { status, body } = await json("/api/me", {
      method: "DELETE",
      token: token2,
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("deleted user no longer in list", async () => {
    const { body } = await json("/api/users", { token: token1 });
    const deleted = body.filter((u: any) => u.username === "bob");
    expect(deleted.length).toBe(0);
  });
});

describe("Socket.IO", () => {
  test("connect with valid token", async () => {
    const socket = SocketIOClient(`http://localhost:${PORT}`, {
      auth: { token: token1 },
      transports: ["websocket"],
    });
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", () => { socket.close(); resolve(); });
      socket.on("connect_error", (err) => { socket.close(); reject(err); });
      setTimeout(() => { socket.close(); reject(new Error("timeout")); }, 5000);
    });
  });

  test("connect with invalid token fails", async () => {
    const socket = SocketIOClient(`http://localhost:${PORT}`, {
      auth: { token: "bad-token" },
      transports: ["websocket"],
    });
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", () => { socket.close(); reject(new Error("should not connect")); });
      socket.on("connect_error", () => { socket.close(); resolve(); });
      setTimeout(() => { socket.close(); reject(new Error("timeout")); }, 5000);
    });
  });

  test("join and leave room", async () => {
    const socket = SocketIOClient(`http://localhost:${PORT}`, {
      auth: { token: token1 },
      transports: ["websocket"],
    });
    await new Promise<void>((resolve) => {
      socket.on("connect", () => {
        socket.emit("join:room", { roomId });
        setTimeout(() => {
          socket.emit("leave:room", { roomId });
          socket.close();
          resolve();
        }, 100);
      });
    });
  });

  test("send message via socket broadcasts to room", async () => {
    const socket1 = SocketIOClient(`http://localhost:${PORT}`, {
      auth: { token: token1 },
      transports: ["websocket"],
    });
    const socket2 = SocketIOClient(`http://localhost:${PORT}`, {
      auth: { token: token2 },
      transports: ["websocket"],
    });

    await new Promise<void>((resolve, reject) => {
      let s1Ready = false;
      let s2Ready = false;

      socket1.on("connect", () => {
        s1Ready = true;
        socket1.emit("join:room", { roomId });
        if (s1Ready && s2Ready) start();
      });
      socket2.on("connect", () => {
        s2Ready = true;
        socket2.emit("join:room", { roomId });
        if (s1Ready && s2Ready) start();
      });

      function start() {
        socket2.on("message:new", (msg: any) => {
          expect(msg.content).toBe("Socket test message");
          expect(msg.username).toBe("alice");
          socket1.close();
          socket2.close();
          resolve();
        });

        socket1.emit("message:send", {
          roomId,
          content: "Socket test message",
        });

        setTimeout(() => {
          socket1.close();
          socket2.close();
          reject(new Error("timeout waiting for message"));
        }, 5000);
      }
    });
  });

  test("typing indicators work", async () => {
    const socket = SocketIOClient(`http://localhost:${PORT}`, {
      auth: { token: token1 },
      transports: ["websocket"],
    });
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", () => {
        socket.emit("join:room", { roomId });
        socket.emit("typing:start", { roomId });
        setTimeout(() => {
          socket.emit("typing:stop", { roomId });
          socket.close();
          resolve();
        }, 100);
      });
      setTimeout(() => { socket.close(); reject(new Error("timeout")); }, 5000);
    });
  });

  test("status update via socket", async () => {
    const socket = SocketIOClient(`http://localhost:${PORT}`, {
      auth: { token: token1 },
      transports: ["websocket"],
    });
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", () => {
        socket.emit("status:update", { status: "dnd", customStatus: "In a meeting" });
        setTimeout(() => {
          socket.close();
          resolve();
        }, 200);
      });
      setTimeout(() => { socket.close(); reject(new Error("timeout")); }, 5000);
    });
  });
});

describe("Health Checks", () => {
  test("GET /healthz returns ok", async () => {
    const res = await fetch(`${BASE}/healthz`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });

  test("GET /readyz returns ok with db connected", async () => {
    const res = await fetch(`${BASE}/readyz`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
  });
});

describe("Rate Limit Headers", () => {
  test("responses include X-RateLimit headers", async () => {
    const res = await fetchJson("/api/me", { token: token1 });
    expect(res.headers.has("X-RateLimit-Limit")).toBe(true);
    expect(res.headers.has("X-RateLimit-Remaining")).toBe(true);
    expect(res.headers.has("X-RateLimit-Reset")).toBe(true);
  });
});

describe("Admin", () => {
  test("GET /admin returns HTML", async () => {
    const res = await fetch(`${BASE}/admin`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Chat Admin");
  });

  test("GET /admin/stats returns JSON stats", async () => {
    const { status, body } = await json("/admin/stats", { token: token1 });
    expect(status).toBe(200);
    expect(body).toHaveProperty("user_count");
    expect(body).toHaveProperty("message_count");
    expect(body).toHaveProperty("room_count");
  });

  test("no token redirects to 401", async () => {
    const res = await fetch(`${BASE}/admin`);
    expect(res.status).toBe(401);
  });
});
