import { WebSocketServer, WebSocket } from "ws";

const port = Number(process.env.SIGNAL_PORT || 3001);
const rooms = new Map();
const wss = new WebSocketServer({ host: "0.0.0.0", port });

function send(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function remove(socket) {
  const { room, role } = socket.session || {};
  if (!room || !role) return;
  const peers = rooms.get(room);
  if (!peers) return;
  if (peers[role] === socket) peers[role] = null;
  const other = role === "host" ? peers.guest : peers.host;
  send(other, { type: "peer-left" });
  if (!peers.host && !peers.guest) rooms.delete(room);
}

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }

    if (message.type === "join") {
      const room = String(message.room || "").slice(0, 80);
      const role = message.role === "guest" ? "guest" : "host";
      if (!room) return send(socket, { type: "error", message: "会话编号无效" });
      const peers = rooms.get(room) || { host: null, guest: null };
      if (peers[role] && peers[role] !== socket) peers[role].close();
      peers[role] = socket;
      rooms.set(room, peers);
      socket.session = { room, role };
      send(socket, { type: "joined", role });
      if (peers.host && peers.guest) {
        send(peers.host, { type: "ready" });
        send(peers.guest, { type: "ready" });
      }
      return;
    }

    const { room, role } = socket.session || {};
    const peers = rooms.get(room);
    if (!peers) return;
    send(role === "host" ? peers.guest : peers.host, message);
  });

  socket.on("close", () => remove(socket));
  socket.on("error", () => remove(socket));
});

console.log(`Local signaling ready on ws://0.0.0.0:${port}`);
