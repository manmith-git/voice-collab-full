import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { Server as IOSocket } from "socket.io";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as mutex from "lib0/mutex";

const docs = new Map();

// Encode Update message
const messageSync = 0;
const messageAwareness = 1;

// Awareness map
const awarenessStates = new Map();

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const io = new IOSocket(server, { cors: { origin: "*" } });

io.on("connection", socket => {
  socket.on("join-room", room => socket.join(room));
  socket.on("signal", data => {
    io.to(data.to).emit("signal", { from: socket.id, signal: data.signal });
  });
});

// Handle WebSocket Yjs sync
const wss = new WebSocketServer({ server, path: "/yjs" });

wss.on("connection", (ws, req) => {
  const roomName = req.url.split("?room=")[1] || "default";

  if (!docs.has(roomName)) {
    docs.set(roomName, new Y.Doc());
  }
  const ydoc = docs.get(roomName);

  ws.binaryType = "arraybuffer";

  const send = (m) => ws.readyState === WebSocket.OPEN && ws.send(m);

  // Send initial sync message
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  encoding.writeVarUint8Array(encoder, Y.encodeStateAsUpdate(ydoc));
  send(encoding.toUint8Array(encoder));

  ws.on("message", (data) => {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case messageSync:
        Y.applyUpdate(ydoc, decoding.readVarUint8Array(decoder));
        break;
    }

    // Broadcast updates
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  });
});

server.listen(process.env.PORT || 3000, () =>
  console.log("YJS + WebRTC server running")
);
