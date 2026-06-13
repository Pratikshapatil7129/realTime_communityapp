/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

// Body parser
app.use(express.json({ limit: '50mb' }));

// Database mock/file store settings
const DATA_DIR = path.join(process.cwd(), '.data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([]));
}

// User credentials store
interface UserCredentials {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
}

// Session store (in-memory)
const activeSessions = new Map<string, { userId: string; username: string }>();

function getUserDb(): UserCredentials[] {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveUserDb(users: UserCredentials[]) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Create password hash
function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha256').toString('hex');
}

// --- REST Endpoint Handlers ---

// Register User
app.post('/api/auth/register', (req: any, res: any) => {
  const { username, password } = req.body;
  if (!username || !password || username.trim() === '' || password.trim() === '') {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const users = getUserDb();
  const existing = users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
  if (existing) {
    return res.status(400).json({ error: 'Username is already taken.' });
  }

  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  users.push({
    id,
    username: username.trim(),
    passwordHash,
    salt,
  });

  saveUserDb(users);

  // Auto-login upon registration
  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, { userId: id, username: username.trim() });

  return res.status(201).json({
    token,
    user: { id, username: username.trim() },
    message: 'Registration successful!',
  });
});

// Login User
app.post('/api/auth/login', (req: any, res: any) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const users = getUserDb();
  const user = users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());

  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const hash = hashPassword(password, user.salt);
  if (hash !== user.passwordHash) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, { userId: user.id, username: user.username });

  return res.json({
    token,
    user: { id: user.id, username: user.username },
    message: 'User logged in successfully!',
  });
});

// Get Session User details (via token authorization)
app.get('/api/auth/me', (req: any, res: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing authorization header.' });
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const session = activeSessions.get(token);

  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session token.' });
  }

  return res.json({
    id: session.userId,
    username: session.username,
  });
});

// Logout endpoint
app.post('/api/auth/logout', (req: any, res: any) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '').trim();
    activeSessions.delete(token);
  }
  return res.json({ success: true, message: 'Logged out successfully.' });
});

// --- WebSocket & WebRTC Signaling Server ---

const httpServer = createHttpServer(app);
const wss = new WebSocketServer({ noServer: true });

// Attach WS upgrade
httpServer.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// WebSocket Server State
// roomId -> Map<socketId, { ws: WebSocket, userId: string, name: string, isAudioActive: boolean, isVideoActive: boolean, isScreenSharing: boolean }>
interface PeerConnection {
  ws: WebSocket;
  userId: string;
  name: string;
  isAudioActive: boolean;
  isVideoActive: boolean;
  isScreenSharing: boolean;
}

const rooms = new Map<string, Map<string, PeerConnection>>();
// Persistent room content buffers (to sync drawing/chat/files history for later joiners)
const roomDrawings = new Map<string, any[]>();
const roomMessages = new Map<string, any[]>();
const roomFiles = new Map<string, any[]>();

wss.on('connection', (ws: WebSocket) => {
  const clientSocketId = crypto.randomUUID();
  let currentRoomId: string | null = null;
  let currentUserId: string | null = null;
  let currentName: string | null = null;

  ws.on('message', (messageBuffer) => {
    try {
      const data = JSON.parse(messageBuffer.toString());
      
      switch (data.type) {
        case 'join': {
          const { roomId, name, userId, isAudioActive, isVideoActive } = data;
          currentRoomId = roomId;
          currentUserId = userId || clientSocketId;
          currentName = name || 'Anonymous';

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
            roomDrawings.set(roomId, []);
            roomMessages.set(roomId, []);
            roomFiles.set(roomId, []);
          }

          const roomPeers = rooms.get(roomId)!;
          
          // Store connection details
          const participantInfo: PeerConnection = {
            ws,
            userId: currentUserId!,
            name: currentName!,
            isAudioActive: !!isAudioActive,
            isVideoActive: !!isVideoActive,
            isScreenSharing: false,
          };
          roomPeers.set(clientSocketId, participantInfo);

          // Get clean list of existing users to send to joiner
          const existingUsersList = Array.from(roomPeers.entries())
            .filter(([sid]) => sid !== clientSocketId)
            .map(([_, peer]) => ({
              id: peer.userId,
              name: peer.name,
              joinedAt: Date.now(),
              isAudioActive: peer.isAudioActive,
              isVideoActive: peer.isVideoActive,
              isScreenSharing: peer.isScreenSharing,
            }));

          // 1. Welcome the joining client
          ws.send(JSON.stringify({
            type: 'welcome',
            yourId: currentUserId,
            clientList: existingUsersList,
            drawings: roomDrawings.get(roomId) || [],
            messages: roomMessages.get(roomId) || [],
            files: roomFiles.get(roomId) || []
          }));

          // 2. Broadcast join notification to existing peers in the same room
          const joinBroadcast = JSON.stringify({
            type: 'user-joined',
            user: {
              id: currentUserId,
              name: currentName,
              joinedAt: Date.now(),
              isAudioActive: !!isAudioActive,
              isVideoActive: !!isVideoActive,
              isScreenSharing: false,
            }
          });

          roomPeers.forEach((peer, sid) => {
            if (sid !== clientSocketId) {
              peer.ws.send(joinBroadcast);
            }
          });
          break;
        }

        case 'media-toggle': {
          if (!currentRoomId || !rooms.has(currentRoomId)) return;
          const roomPeers = rooms.get(currentRoomId)!;
          const self = roomPeers.get(clientSocketId);
          if (!self) return;

          const { field, value } = data; // field: 'audio' | 'video' | 'screen'
          if (field === 'audio') self.isAudioActive = value;
          if (field === 'video') self.isVideoActive = value;
          if (field === 'screen') self.isScreenSharing = value;

          // Broadcast active state toggle to all other peers in room
          const mediaBroadcast = JSON.stringify({
            type: 'media-toggle',
            userId: currentUserId,
            field,
            value,
          });

          roomPeers.forEach((peer, sid) => {
            if (sid !== clientSocketId) {
              peer.ws.send(mediaBroadcast);
            }
          });
          break;
        }

        // RTC SDP Negotiations: Route Offer, Answer, Ice Candidate to targeted peer
        case 'offer':
        case 'answer':
        case 'ice-candidate': {
          if (!currentRoomId || !rooms.has(currentRoomId)) return;
          const roomPeers = rooms.get(currentRoomId)!;
          const { targetId } = data;

          // Find the target socket matching the receiver userId
          let targetSocket: WebSocket | null = null;
          for (const [_, peer] of roomPeers.entries()) {
            if (peer.userId === targetId) {
              targetSocket = peer.ws;
              break;
            }
          }

          if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
            targetSocket.send(JSON.stringify({
              ...data,
              senderId: currentUserId,
            }));
          }
          break;
        }

        // Shared chat message
        case 'chat-message': {
          if (!currentRoomId || !rooms.has(currentRoomId)) return;
          const { message } = data;
          
          const msgs = roomMessages.get(currentRoomId) || [];
          msgs.push(message);
          roomMessages.set(currentRoomId, msgs);

          // Broadcast to everyone else
          const roomPeers = rooms.get(currentRoomId)!;
          roomPeers.forEach((peer, sid) => {
            if (sid !== clientSocketId) {
              peer.ws.send(JSON.stringify({
                type: 'chat-message',
                message,
              }));
            }
          });
          break;
        }

        // Shared file
        case 'file-shared': {
          if (!currentRoomId || !rooms.has(currentRoomId)) return;
          const { file } = data;

          const files = roomFiles.get(currentRoomId) || [];
          files.push(file);
          roomFiles.set(currentRoomId, files);

          // Broadcast file shared details to all room peers
          const roomPeers = rooms.get(currentRoomId)!;
          roomPeers.forEach((peer, sid) => {
            if (sid !== clientSocketId) {
              peer.ws.send(JSON.stringify({
                type: 'file-shared',
                file,
              }));
            }
          });
          break;
        }

        // Real-time canvas drawings
        case 'draw-stroke': {
          if (!currentRoomId || !rooms.has(currentRoomId)) return;
          const { stroke } = data;

          const drawings = roomDrawings.get(currentRoomId) || [];
          drawings.push(stroke);
          roomDrawings.set(currentRoomId, drawings);

          // Broadcast drawing activity
          const roomPeers = rooms.get(currentRoomId)!;
          roomPeers.forEach((peer, sid) => {
            if (sid !== clientSocketId) {
              peer.ws.send(JSON.stringify({
                type: 'draw-stroke',
                stroke,
              }));
            }
          });
          break;
        }

        case 'draw-clear': {
          if (!currentRoomId || !rooms.has(currentRoomId)) return;
          roomDrawings.set(currentRoomId, []);

          // Broadcast canvas wipe
          const roomPeers = rooms.get(currentRoomId)!;
          roomPeers.forEach((peer, sid) => {
            if (sid !== clientSocketId) {
              peer.ws.send(JSON.stringify({
                type: 'draw-clear',
              }));
            }
          });
          break;
        }
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (currentRoomId && rooms.has(currentRoomId)) {
      const roomPeers = rooms.get(currentRoomId)!;
      roomPeers.delete(clientSocketId);

      // Clean up room memory if entirely abandoned 
      if (roomPeers.size === 0) {
        rooms.delete(currentRoomId);
        roomDrawings.delete(currentRoomId);
        roomMessages.delete(currentRoomId);
        roomFiles.delete(currentRoomId);
      } else {
        // Notify others of immediate user departure
        const leaveMessage = JSON.stringify({
          type: 'user-left',
          userId: currentUserId,
        });
        roomPeers.forEach((peer) => {
          if (peer.ws.readyState === WebSocket.OPEN) {
            peer.ws.send(leaveMessage);
          }
        });
      }
    }
  });
});

// --- Boot Strapping Framework Servers (Vite + Express) ---

async function initServer() {
  if (process.env.NODE_ENV !== 'production') {
    // Run Vite dev server in middleware mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production statics
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server fully operative on http://0.0.0.0:${PORT}`);
  });
}

initServer().catch((e) => {
  console.error("Critical failure bootstrapping Express + Vite environment:", e);
});
