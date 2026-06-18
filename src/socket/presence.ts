import type { Server, Socket } from "socket.io";
import { onlineUsers } from "../lib/presence";
import { db, schema } from "../lib/db";
import { eq } from "drizzle-orm";

export function handlePresence(io: Server, socket: Socket) {
  const userId = socket.data.userId;
  const username = socket.data.username;
  if (!userId) return;

  onlineUsers.add(userId);

  db.select({
    status: schema.users.status,
    customStatus: schema.users.customStatus,
    customStatusEmoji: schema.users.customStatusEmoji,
  })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1)
    .then((rows) => {
      const user = rows[0];
      io.emit("user:online", {
        userId,
        username,
        status: user?.status || "online",
        customStatus: user?.customStatus,
        customStatusEmoji: user?.customStatusEmoji,
      });
    });

  socket.on("status:update", (data: { status?: string; customStatus?: string; customStatusEmoji?: string }) => {
    const updates: Record<string, unknown> = {};
    if (data.status) updates.status = data.status;
    if (data.customStatus !== undefined) updates.customStatus = data.customStatus;
    if (data.customStatusEmoji !== undefined) updates.customStatusEmoji = data.customStatusEmoji;

    if (Object.keys(updates).length > 0) {
      db.update(schema.users)
        .set(updates)
        .where(eq(schema.users.id, userId))
        .catch(() => {});

      io.emit("user:status", {
        userId,
        username,
        ...data,
      });
    }
  });

  socket.on("disconnect", () => {
    const isOnline = Array.from(io.sockets.sockets.values()).some(
      (s) => s.data.userId === userId && s.id !== socket.id,
    );

    if (!isOnline) {
      onlineUsers.delete(userId);
      db.update(schema.users)
        .set({ lastSeenAt: new Date() })
        .where(eq(schema.users.id, userId))
        .catch(() => {});

      io.emit("user:offline", {
        userId,
        username,
      });
    }
  });
}
