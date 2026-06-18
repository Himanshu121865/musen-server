import type { Server, Socket } from "socket.io";

export function handleCallEvents(_io: Server, socket: Socket) {
  socket.on("call:offer", (data: { roomId: number; sdp: any }) => {
    socket.to(`room:${data.roomId}`).emit("call:offer", {
      userId: socket.data.userId,
      username: socket.data.username,
      sdp: data.sdp,
    });
  });

  socket.on("call:answer", (data: { roomId: number; sdp: any }) => {
    socket.to(`room:${data.roomId}`).emit("call:answer", {
      userId: socket.data.userId,
      username: socket.data.username,
      sdp: data.sdp,
    });
  });

  socket.on(
    "call:ice-candidate",
    (data: { roomId: number; candidate: any }) => {
      socket.to(`room:${data.roomId}`).emit("call:ice-candidate", {
        userId: socket.data.userId,
        candidate: data.candidate,
      });
    },
  );

  socket.on("call:end", (data: { roomId: number }) => {
    socket.to(`room:${data.roomId}`).emit("call:end", {
      userId: socket.data.userId,
      roomId: data.roomId,
    });
  });
}
