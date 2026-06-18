import type { Socket } from "socket.io";

export function handleTypingStart(socket: Socket, data: { roomId: number }) {
  if (!data.roomId) return;
  socket.to(`room:${data.roomId}`).emit("user:typing", {
    userId: socket.data.userId,
    username: socket.data.username,
    roomId: data.roomId,
  });
}

export function handleTypingStop(socket: Socket, data: { roomId: number }) {
  if (!data.roomId) return;
  socket.to(`room:${data.roomId}`).emit("user:typing", {
    userId: socket.data.userId,
    username: socket.data.username,
    roomId: data.roomId,
    stopped: true,
  });
}
