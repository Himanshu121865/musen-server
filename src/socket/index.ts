import { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { verifyToken } from "../lib/auth";
import {
  handleMessageSend,
  handleMessageEdit,
  handleMessageDelete,
  handleMessageReact,
} from "./messages";
import { handleTypingStart, handleTypingStop } from "./typing";
import { handlePresence } from "./presence";
import { handleCallEvents } from "./calls";
import { db, schema } from "../lib/db";
import { eq } from "drizzle-orm";

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication required"));
    }

    try {
      const payload = verifyToken(token);
      socket.data.userId = payload.userId;
      socket.data.username = payload.username;

      const [user] = await db
        .select({
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
          status: schema.users.status,
          customStatus: schema.users.customStatus,
          customStatusEmoji: schema.users.customStatusEmoji,
        })
        .from(schema.users)
        .where(eq(schema.users.id, payload.userId))
        .limit(1);

      if (user) {
        socket.data.displayName = user.displayName;
        socket.data.avatarUrl = user.avatarUrl;
        socket.data.status = user.status;
        socket.data.customStatus = user.customStatus;
        socket.data.customStatusEmoji = user.customStatusEmoji;
      }

      next();
    } catch {
      return next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    handlePresence(io, socket);

    socket.on("join:room", (data: { roomId: number }) => {
      if (data?.roomId) {
        socket.join(`room:${data.roomId}`);
      }
    });

    socket.on("leave:room", (data: { roomId: number }) => {
      if (data?.roomId) {
        socket.leave(`room:${data.roomId}`);
      }
    });

    socket.on(
      "message:send",
      (data: any, callback?: (res: any) => void) => {
        handleMessageSend(socket, data, callback);
      },
    );

    socket.on(
      "message:edit",
      (data: any, callback?: (res: any) => void) => {
        handleMessageEdit(socket, data, callback);
      },
    );

    socket.on(
      "message:delete",
      (data: any, callback?: (res: any) => void) => {
        handleMessageDelete(socket, data, callback);
      },
    );

    socket.on(
      "message:react",
      (data: any, callback?: (res: any) => void) => {
        handleMessageReact(socket, data, callback);
      },
    );

    socket.on("typing:start", (data: { roomId: number }) => {
      handleTypingStart(socket, data);
    });

    socket.on("typing:stop", (data: { roomId: number }) => {
      handleTypingStop(socket, data);
    });

    handleCallEvents(io, socket);
  });

  return io;
}
