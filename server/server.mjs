import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { Server as IOSocket } from "socket.io";
import * as Y from "yjs";

const docs = new Map();

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

// Simple YJS WebSocket Server
const wss = new WebSocketServer({ 
  noServer: true  // We'll handle upgrade manually
});

console.log("YJS WebSocket handler ready");

// Handle WebSocket upgrade for /yjs path
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, 'ws://localhost').pathname;
  
  console.log(`WebSocket upgrade request for: ${pathname}`);
  
  if (pathname === '/yjs') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Handle YJS connections
wss.on("connection", (ws, req) => {
  console.log("YJS client connected");
  
  try {
    // Parse room from URL
    const url = new URL(req.url, `http://${req.headers.host}`);
    const roomName = url.searchParams.get("room") || "default";
    
    console.log(`Room: ${roomName}`);
    
    // Get or create YJS document
    if (!docs.has(roomName)) {
      console.log(`Creating new document for room: ${roomName}`);
      docs.set(roomName, new Y.Doc());
    }
    
    const ydoc = docs.get(roomName);
    ws.roomName = roomName;
    
    // Send initial state
    const state = Y.encodeStateAsUpdate(ydoc);
    ws.send(Buffer.from([0, ...state])); // 0 = sync message type
    
    console.log(`Sent initial state (${state.length} bytes)`);
    
    // Handle messages
    ws.on("message", (data) => {
      try {
        const message = new Uint8Array(data);
        const messageType = message[0];
        
        console.log(`Received message type: ${messageType}, length: ${message.length}`);
        
        if (messageType === 0) { // Sync update
          const update = message.slice(1);
          Y.applyUpdate(ydoc, update);
          
          // Broadcast to all other clients in same room
          wss.clients.forEach(client => {
            if (client !== ws && 
                client.readyState === 1 && 
                client.roomName === roomName) {
              client.send(data);
            }
          });
          
          console.log(`Broadcast update to room ${roomName}`);
        }
      } catch (err) {
        console.error("Error handling message:", err);
      }
    });
    
    ws.on("close", () => {
      console.log(`Client disconnected from room: ${roomName}`);
    });
    
    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
    });
    
  } catch (err) {
    console.error("Error in connection handler:", err);
    ws.close();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Socket.IO ready for WebRTC`);
  console.log(`✓ YJS WebSocket ready on /yjs`);
});