import type { Socket } from "socket.io";
import { db, schema } from "../lib/db";
import { eq, and } from "drizzle-orm";

interface MessageSendData {
  roomId: number;
  content?: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
}

export function handleMessageSend(
  socket: Socket,
  data: MessageSendData,
  callback?: (res: any) => void,
) {
  const userId = socket.data.userId;
  const username = socket.data.username;

  if (!data.roomId) {
    callback?.({ error: "roomId is required" });
    return;
  }

  db.select()
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, data.roomId),
        eq(schema.roomMembers.userId, userId),
      ),
    )
    .limit(1)
    .then((membership) => {
      if (membership.length === 0) {
        callback?.({ error: "Not a member of this room" });
        return;
      }

      return db
        .insert(schema.messages)
        .values({
          roomId: data.roomId,
          userId,
          content: data.content || null,
          fileUrl: data.fileUrl || null,
          fileName: data.fileName || null,
          fileSize: data.fileSize || null,
          fileType: data.fileType || null,
        })
        .returning();
    })
    .then((msg) => {
      if (!msg) return;

      const message = {
        ...msg[0],
        username,
        displayName: socket.data.displayName || null,
        avatarUrl: socket.data.avatarUrl || null,
      };

      socket.to(`room:${data.roomId}`).emit("message:new", message);
      callback?.(message);
    })
    .catch((err) => {
      console.error("message:send error:", err);
      callback?.({ error: "Failed to send message" });
    });
}

export function handleMessageEdit(
  socket: Socket,
  data: { messageId: number; content: string },
  callback?: (res: any) => void,
) {
  const userId = socket.data.userId;

  if (!data.messageId || !data.content) {
    callback?.({ error: "messageId and content are required" });
    return;
  }

  db.select()
    .from(schema.messages)
    .where(eq(schema.messages.id, data.messageId))
    .limit(1)
    .then((msgs) => {
      const msg = msgs[0];
      if (!msg) {
        callback?.({ error: "Message not found" });
        return null;
      }
      if (msg.userId !== userId) {
        callback?.({ error: "Not your message" });
        return null;
      }
      return db
        .update(schema.messages)
        .set({ content: data.content, editedAt: new Date() })
        .where(eq(schema.messages.id, data.messageId))
        .returning();
    })
    .then((updated) => {
      if (!updated) return;
      socket.to(`room:${updated[0].roomId}`).emit("message:updated", {
        messageId: updated[0].id,
        content: updated[0].content,
        editedAt: updated[0].editedAt,
      });
      callback?.(updated[0]);
    })
    .catch((err) => {
      console.error("message:edit error:", err);
      callback?.({ error: "Failed to edit message" });
    });
}

export function handleMessageDelete(
  socket: Socket,
  data: { messageId: number },
  callback?: (res: any) => void,
) {
  const userId = socket.data.userId;

  if (!data.messageId) {
    callback?.({ error: "messageId is required" });
    return;
  }

  db.select()
    .from(schema.messages)
    .where(eq(schema.messages.id, data.messageId))
    .limit(1)
    .then((msgs) => {
      const msg = msgs[0];
      if (!msg) {
        callback?.({ error: "Message not found" });
        return null;
      }
      if (msg.userId !== userId) {
        callback?.({ error: "Not your message" });
        return null;
      }
      return db
        .update(schema.messages)
        .set({ deletedAt: new Date() })
        .where(eq(schema.messages.id, data.messageId))
        .returning();
    })
    .then((updated) => {
      if (!updated) return;
      socket.to(`room:${updated[0].roomId}`).emit("message:deleted", {
        messageId: data.messageId,
      });
      callback?.({ success: true });
    })
    .catch((err) => {
      console.error("message:delete error:", err);
      callback?.({ error: "Failed to delete message" });
    });
}

export function handleMessageReact(
  socket: Socket,
  data: { messageId: number; emoji: string },
  callback?: (res: any) => void,
) {
  const userId = socket.data.userId;

  if (!data.messageId || !data.emoji) {
    callback?.({ error: "messageId and emoji are required" });
    return;
  }

  (async () => {
    const [msg] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, data.messageId))
      .limit(1);

    if (!msg) {
      callback?.({ error: "Message not found" });
      return;
    }

    const [existing] = await db
      .select()
      .from(schema.messageReactions)
      .where(
        and(
          eq(schema.messageReactions.messageId, data.messageId),
          eq(schema.messageReactions.userId, userId),
          eq(schema.messageReactions.emoji, data.emoji),
        ),
      )
      .limit(1);

    let action: "add" | "remove";
    if (existing) {
      await db
        .delete(schema.messageReactions)
        .where(eq(schema.messageReactions.id, existing.id));
      action = "remove";
    } else {
      await db
        .insert(schema.messageReactions)
        .values({ messageId: data.messageId, userId, emoji: data.emoji });
      action = "add";
    }

    socket.to(`room:${msg.roomId}`).emit("message:reaction", {
      messageId: data.messageId,
      emoji: data.emoji,
      userId,
      action,
    });
    callback?.({ messageId: data.messageId, emoji: data.emoji, userId, action });
  })().catch((err) => {
    console.error("message:react error:", err);
    callback?.({ error: "Failed to react to message" });
  });
}
