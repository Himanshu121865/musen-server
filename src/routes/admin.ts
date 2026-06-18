import { Hono } from "hono";
import { db, schema } from "../lib/db";
import { authMiddleware, getUserId } from "../middleware/auth";
import { HTTPError } from "../lib/errors";
import { config } from "../config";
import { eq } from "drizzle-orm";

const router = new Hono();

async function adminCheck(c: any) {
  const userId = getUserId(c);
  const [user] = await db
    .select({ username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user || user.username !== config.adminUsername) {
    throw new HTTPError(403, "Admin access required");
  }
  return user;
}

router.use(authMiddleware);

router.get("/", async (c) => {
  await adminCheck(c as any);

  const stats = await db.execute(
    `SELECT
       (SELECT COUNT(*) FROM users)::int as user_count,
       (SELECT COUNT(*) FROM messages WHERE deleted_at IS NULL)::int as message_count,
       (SELECT COUNT(*) FROM rooms)::int as room_count`,
  );

  const users = await db.execute(
    `SELECT u.id, u.username, u.display_name, u.created_at, u.last_seen_at,
       (SELECT COUNT(*)::int FROM messages m WHERE m.user_id = u.id AND m.deleted_at IS NULL) as msg_count
     FROM users u ORDER BY u.created_at DESC LIMIT 50`,
  );

  const recentMessages = await db.execute(
    `SELECT m.id, m.content, m.created_at, u.username
     FROM messages m
     LEFT JOIN users u ON u.id = m.user_id
     WHERE m.deleted_at IS NULL
     ORDER BY m.created_at DESC LIMIT 30`,
  );

  return c.html(
    renderAdmin(
      (stats as any)[0] as any,
      (users as any) as any[],
      (recentMessages as any) as any[],
    ),
  );
});

router.get("/stats", async (c) => {
  await adminCheck(c as any);

  const stats = await db.execute(
    `SELECT
       (SELECT COUNT(*) FROM users)::int as user_count,
       (SELECT COUNT(*) FROM messages WHERE deleted_at IS NULL)::int as message_count,
       (SELECT COUNT(*) FROM rooms)::int as room_count,
       (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '24 hours')::int as users_today,
       (SELECT COUNT(*) FROM messages WHERE created_at > NOW() - INTERVAL '24 hours')::int as messages_today`,
  );

  return c.json((stats as any)[0] ?? {});
});

router.delete("/messages/:id", async (c) => {
  await adminCheck(c as any);
  const messageId = parseInt(c.req.param("id"), 10);

  await db
    .update(schema.messages)
    .set({ deletedAt: new Date() })
    .where(eq(schema.messages.id, messageId));

  return c.json({ success: true });
});

function renderAdmin(
  stats: { user_count: number; message_count: number; room_count: number } | undefined,
  users: any[],
  messages: any[],
): string {
  const s = stats || { user_count: 0, message_count: 0, room_count: 0 };
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chat Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #111; color: #eee; padding: 24px; }
    h1 { font-size: 24px; margin-bottom: 24px; color: #fff; }
    .stats { display: flex; gap: 16px; margin-bottom: 32px; }
    .stat { background: #1a1a2e; padding: 16px 24px; border-radius: 8px; flex: 1; }
    .stat h2 { font-size: 32px; color: #7c3aed; }
    .stat p { font-size: 12px; color: #888; text-transform: uppercase; margin-top: 4px; }
    .section { margin-bottom: 24px; }
    .section h2 { font-size: 18px; margin-bottom: 12px; color: #ccc; }
    table { width: 100%; border-collapse: collapse; background: #1a1a2e; border-radius: 8px; overflow: hidden; }
    th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #2a2a3e; font-size: 13px; }
    th { background: #16213e; color: #888; font-weight: 600; text-transform: uppercase; font-size: 11px; }
    td { color: #ddd; }
    .msg-preview { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #aaa; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; background: #7c3aed33; color: #a78bfa; }
  </style>
</head>
<body>
  <h1>Chat Admin</h1>
  <div class="stats">
    <div class="stat"><h2>${s.user_count}</h2><p>Users</p></div>
    <div class="stat"><h2>${s.message_count}</h2><p>Messages</p></div>
    <div class="stat"><h2>${s.room_count}</h2><p>Rooms</p></div>
  </div>
  <div class="section">
    <h2>Users</h2>
    <table>
      <thead><tr><th>ID</th><th>Username</th><th>Display Name</th><th>Messages</th><th>Joined</th></tr></thead>
      <tbody>
        ${users.map((u: any) => `<tr>
          <td>${u.id}</td>
          <td>${u.username} <span class="badge">${u.username === config.adminUsername ? 'admin' : 'user'}</span></td>
          <td>${u.display_name || '—'}</td>
          <td>${u.msg_count}</td>
          <td>${new Date(u.created_at).toLocaleDateString()}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  <div class="section">
    <h2>Recent Messages</h2>
    <table>
      <thead><tr><th>ID</th><th>User</th><th>Content</th><th>Date</th></tr></thead>
      <tbody>
        ${messages.map((m: any) => `<tr>
          <td>${m.id}</td>
          <td>${m.username || 'deleted'}</td>
          <td class="msg-preview">${m.content || '(file)'}</td>
          <td>${new Date(m.created_at).toLocaleString()}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

export default router;
