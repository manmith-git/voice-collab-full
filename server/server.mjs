import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { Server as IOSocket } from "socket.io";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";

const docs = new Map();
const awarenessStates = new Map();

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);

// Socket.IO for WebRTC signaling
const io = new IOSocket(server, { 
  cors: { origin: "*" } 
});

io.on("connection", socket => {
  console.log("Socket.IO client connected:", socket.id);
  
  socket.on("join-room", room => {
    console.log(`Client ${socket.id} joining room: ${room}`);
    socket.join(room);
    socket.to(room).emit("user-joined", socket.id);
  });
  
  socket.on("signal", data => {
    io.to(data.to).emit("signal", { 
      from: socket.id, 
      signal: data.signal 
    });
  });
  
  socket.on("disconnect", () => {
    console.log("Socket.IO client disconnected:", socket.id);
  });
});

// WebSocket for YJS sync
const wss = new WebSocketServer({ 
  server, 
  path: "/yjs"
});

console.log("WebSocket server listening on path: /yjs");

wss.on("connection", (ws, req) => {
  console.log("YJS WebSocket connection established");
  
  // Parse room from URL query
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomName = url.searchParams.get("room") || "default";
  
  console.log(`YJS client connected to room: ${roomName}`);
  
  // Get or create document for this room
  if (!docs.has(roomName)) {
    console.log(`Creating new YJS document for room: ${roomName}`);
    docs.set(roomName, new Y.Doc());
  }
  
  const ydoc = docs.get(roomName);
  
  // Create awareness for this room if it doesn't exist
  if (!awarenessStates.has(roomName)) {
    awarenessStates.set(roomName, new awarenessProtocol.Awareness(ydoc));
  }
  
  const awareness = awarenessStates.get(roomName);
  
  ws.binaryType = "arraybuffer";
  
  // Send function
  const send = (message) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  };
  
  // Send sync step 1
  const encoderSync = encoding.createEncoder();
  encoding.writeVarUint(encoderSync, 0); // messageSync
  syncProtocol.writeSyncStep1(encoderSync, ydoc);
  send(encoding.toUint8Array(encoderSync));
  
  // Send awareness state
  const encoderAwareness = encoding.createEncoder();
  encoding.writeVarUint(encoderAwareness, 1); // messageAwareness
  encoding.writeVarUint8Array(
    encoderAwareness,
    awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awareness.getStates().keys()))
  );
  send(encoding.toUint8Array(encoderAwareness));
  
  // Handle incoming messages
  ws.on("message", (data) => {
    try {
      const uint8Data = new Uint8Array(data);
      const decoder = decoding.createDecoder(uint8Data);
      const messageType = decoding.readVarUint(decoder);
      
      switch (messageType) {
        case 0: // Sync
          encoding.writeVarUint(encoderSync, 0);
          const syncMessageType = syncProtocol.readSyncMessage(decoder, encoderSync, ydoc, null);
          
          if (encoding.length(encoderSync) > 1) {
            send(encoding.toUint8Array(encoderSync));
          }
          
          // Broadcast to other clients in the same room
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN && client.roomName === roomName) {
              send(encoding.toUint8Array(encoderSync));
            }
          });
          break;
          
        case 1: // Awareness
          awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), null);
          
          // Broadcast awareness to other clients
          const awarenessUpdate = encoding.toUint8Array(
            awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awareness.getStates().keys()))
          );
          
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN && client.roomName === roomName) {
              client.send(awarenessUpdate);
            }
          });
          break;
      }
    } catch (err) {
      console.error("Error handling YJS message:", err);
    }
  });
  
  // Store room name on connection for broadcasting
  ws.roomName = roomName;
  
  ws.on("close", () => {
    console.log(`YJS client disconnected from room: ${roomName}`);
    
    // Remove from awareness
    awarenessProtocol.removeAwarenessStates(
      awareness,
      Array.from(awareness.getStates().keys()).filter(client => client === ws),
      null
    );
  });
  
  ws.on("error", (err) => {
    console.error("YJS WebSocket error:", err);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Socket.IO enabled for WebRTC`);
  console.log(`✓ YJS WebSocket enabled on /yjs`);
});