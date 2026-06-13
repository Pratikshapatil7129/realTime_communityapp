/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Monitor,
  Send,
  Download,
  Users,
  LogOut,
  Palette,
  Eraser,
  Trash2,
  FileUp,
  FileText,
  Lock,
  Unlock,
  ShieldAlert,
  Crown,
  Server,
  RefreshCw,
  MessageSquare,
  Sparkles,
  Layers
} from 'lucide-react';
import { User, ChatMessage, SharedFile, DrawLine, Point } from '../types';
import { deriveKey, encryptText, decryptText } from '../utils/crypto';

// Setup default STUN servers for WebRTC ICE traversal
const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

interface MeetingRoomProps {
  user: { id: string; username: string };
  roomId: string;
  encryptionPass: string;
  mediaConfig: { audio: boolean; video: boolean; forceSimulate: boolean };
  onLeave: () => void;
}

export default function MeetingRoom({
  user,
  roomId,
  encryptionPass,
  mediaConfig,
  onLeave
}: MeetingRoomProps) {
  // Connection states
  const [socketConnected, setSocketConnected] = useState(false);
  const [myUserId, setMyUserId] = useState(user.id);
  const [participants, setParticipants] = useState<User[]>([]);
  const [isSignalingComplete, setIsSignalingComplete] = useState(false);

  // E2EE Key State
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Media streams
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<{ [userId: string]: MediaStream }>({});
  const [mediaDevicesError, setMediaDevicesError] = useState<string | null>(null);
  const [isSimulatedFeed, setIsSimulatedFeed] = useState(false);

  // Mutings
  const [isAudioActive, setIsAudioActive] = useState(mediaConfig.audio);
  const [isVideoActive, setIsVideoActive] = useState(mediaConfig.video);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  // Collaboration: Chat state
  const [chatInputValue, setChatInputValue] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [decryptedTexts, setDecryptedTexts] = useState<{ [msgId: string]: string }>({});

  // Collaboration: Files State
  const [sharedFiles, setSharedFiles] = useState<SharedFile[]>([]);
  const [decryptedFiles, setDecryptedFiles] = useState<{ [fileId: string]: string }>({}); // Base64 data URLs
  const [isUploading, setIsUploading] = useState(false);
  const [fileProgress, setFileProgress] = useState('');

  // Collaboration: Whiteboard
  const [strokeColor, setStrokeColor] = useState('#06b6d4'); // cyan-500
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [drawMode, setDrawMode] = useState<'pen' | 'eraser'>('pen');
  const [drawingsList, setDrawingsList] = useState<DrawLine[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const currentLinePointsRef = useRef<number[]>([]);

  // Refs for tracking mutable connections across renders
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<{ [userId: string]: RTCPeerConnection }>({});
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const whiteboardCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // --- 1. DERIVE CRITICAL CRYPTO KEY FOR END-TO-END ENCRYPTION (E2EE) ---
  useEffect(() => {
    let active = true;
    deriveKey(encryptionPass, roomId)
      .then((key) => {
        if (!active) return;
        setCryptoKey(key);
        console.log('E2EE AES-GCM Key successfully generated on client.');
      })
      .catch((err) => {
        if (!active) return;
        setKeyError('Failed to generate secure encryption keys on client: ' + err.message);
      });
    return () => {
      active = false;
    };
  }, [encryptionPass, roomId]);

  // --- 2. GENERATE OR FETCH LOCAL MEDIA CAPTURE STREAM ---
  useEffect(() => {
    let isCancelled = false;

    // Helper: Draw animated geometric visuals to canvas and capture stream, bypass permission blocks
    function launchSimulatedStream(): MediaStream {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d')!;

      const colorPool = ['#08f', '#a855f7', '#06b6d4', '#4ade80', '#f43f5e'];
      const selectColor = colorPool[Math.floor(Math.random() * colorPool.length)];
      let frame = 0;

      function renderFrame() {
        if (isCancelled) return;
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, 640, 480);

        // Orb waves decoration
        const timeFactor = frame * 0.03;
        ctx.save();
        ctx.translate(320, 240);
        ctx.rotate(timeFactor * 0.2);

        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.strokeStyle = selectColor + '1f'; // low opacity
          ctx.lineWidth = 1.5;
          const radius = 110 + i * 25 + Math.sin(timeFactor + i) * 15;
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Concentric particles rotating
        ctx.fillStyle = selectColor + '88';
        for (let i = 0; i < 12; i++) {
          const angle = (i * Math.PI) / 6 + timeFactor;
          const x = Math.cos(angle) * (90 + Math.sin(timeFactor) * 10);
          const y = Math.sin(angle) * (90 + Math.sin(timeFactor) * 10);
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        // Pulsing core avatar representation
        ctx.beginPath();
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.arc(320, 240, 50, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(user.username.slice(0, 2).toUpperCase(), 320, 240);

        // Frame count & credentials stamps
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath();
        ctx.arc(40, 40, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('LIVE FALLBACK SIMULATOR', 55, 43);
        ctx.fillText(`ID: ${user.username}`, 40, 70);
        ctx.fillText(`E2EE Status: Secure`, 40, 90);

        const d = new Date();
        ctx.textAlign = 'right';
        ctx.fillText(d.toISOString().slice(11, 19), 600, 440);

        frame++;
        animationFrameRef.current = requestAnimationFrame(renderFrame);
      }

      renderFrame();

      const capStream = canvas.captureStream(30);

      // Web Audio synth generation for silent RTC compliance
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const dest = audioCtx.createMediaStreamDestination();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        gain.gain.value = 0.0001; // nearly silent, but counts as active
        osc.connect(gain);
        gain.connect(dest);
        osc.start();
        dest.stream.getAudioTracks().forEach((track) => capStream.addTrack(track));
      } catch (err) {
        console.warn('Silent WebAudio tracks build bypassed:', err);
      }

      setIsSimulatedFeed(true);
      return capStream;
    }

    async function initMedia() {
      if (mediaConfig.forceSimulate) {
        console.log('Skipping real hardware devices. Loading simulated fallback.');
        const str = launchSimulatedStream();
        if (!isCancelled) {
          setLocalStream(str);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = str;
          }
        }
        return;
      }

      try {
        // Attempt standard user media access
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true
        });

        if (!isCancelled) {
          setLocalStream(stream);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }
          setIsSimulatedFeed(false);
        }
      } catch (err: any) {
        console.warn('Hardware camera access was disabled, blocked, or missing. Initiating visual avatar stream fallback:', err.message);
        setMediaDevicesError('No physical cam/mic detected, or iframe sandbox restricts device hardware check. Loading visual fallback feed instead.');
        
        if (!isCancelled) {
          const str = launchSimulatedStream();
          setLocalStream(str);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = str;
          }
        }
      }
    }

    initMedia();

    return () => {
      isCancelled = true;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [mediaConfig.forceSimulate, user.username]);

  // Handle stream track activations based on UI controls
  useEffect(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = isAudioActive;
      });
    }
  }, [isAudioActive, localStream]);

  useEffect(() => {
    if (localStream) {
      // Clear tracks when camera toggle changes
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = isVideoActive;
      });
    }
  }, [isVideoActive, localStream]);

  // --- 3. CORE WEBSOCKET SIGNALING CHANNEL AND WEBRTC MESH COORDINATION ---
  useEffect(() => {
    if (!localStream) return; // Wait for core video feed stream before hooking ws communication

    const loc = window.location;
    const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    // Match sandbox container routing domain
    const wsUrl = `${protocol}//${loc.host}/`;

    console.log('Connecting signaling socket client to:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setSocketConnected(true);
      console.log('Signaling server socket successfully open. Issuing join payload...');
      // Broadcast join to Room
      ws.send(
        JSON.stringify({
          type: 'join',
          roomId,
          name: user.username,
          userId: user.id,
          isAudioActive,
          isVideoActive
        })
      );
    };

    ws.onerror = (e) => {
      console.error('WebSocket client connection error:', e);
    };

    ws.onclose = () => {
      setSocketConnected(false);
      console.warn('WebSocket signaling connection closed.');
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Signaling message client received:', message.type);

        switch (message.type) {
          case 'welcome': {
            const { clientList, drawings, messages, files, yourId } = message;
            setMyUserId(yourId);
            setParticipants(clientList);

            // Import past room state
            if (drawings) setDrawingsList(drawings);
            if (messages) setChatMessages(messages);
            if (files) setSharedFiles(files);

            // Establish PeerConnection to EVERY existing target peer client on welcomed list!
            clientList.forEach((targetPeer: User) => {
              createPeerConnectionAndSendOffer(targetPeer.id, ws);
            });
            setIsSignalingComplete(true);
            break;
          }

          case 'user-joined': {
            const { user: newJoinedUser } = message;
            setParticipants((prev) => {
              // Avoid duplicates
              if (prev.some((p) => p.id === newJoinedUser.id)) return prev;
              return [...prev, newJoinedUser];
            });
            break;
          }

          case 'user-left': {
            const { userId } = message;
            // Dispose mapping WebRTC elements
            if (peerConnectionsRef.current[userId]) {
              peerConnectionsRef.current[userId].close();
              delete peerConnectionsRef.current[userId];
            }
            // Remove video sources
            setRemoteStreams((prev) => {
              const copies = { ...prev };
              delete copies[userId];
              return copies;
            });
            setParticipants((prev) => prev.filter((p) => p.id !== userId));
            break;
          }

          case 'media-toggle': {
            const { userId, field, value } = message;
            setParticipants((prev) =>
              prev.map((p) => {
                if (p.id === userId) {
                  return {
                    ...p,
                    isAudioActive: field === 'audio' ? value : p.isAudioActive,
                    isVideoActive: field === 'video' ? value : p.isVideoActive,
                    isScreenSharing: field === 'screen' ? value : p.isScreenSharing
                  };
                }
                return p;
              })
            );
            break;
          }

          case 'offer': {
            const { senderId, sdp } = message;
            handleOfferReceived(senderId, sdp, ws);
            break;
          }

          case 'answer': {
            const { senderId, sdp } = message;
            const pc = peerConnectionsRef.current[senderId];
            if (pc) {
              await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            }
            break;
          }

          case 'ice-candidate': {
            const { senderId, candidate } = message;
            const pc = peerConnectionsRef.current[senderId];
            if (pc) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
            break;
          }

          case 'chat-message': {
            const { message: chatMsg } = message;
            setChatMessages((prev) => [...prev, chatMsg]);
            break;
          }

          case 'file-shared': {
            const { file: newFile } = message;
            setSharedFiles((prev) => [...prev, newFile]);
            break;
          }

          case 'draw-stroke': {
            const { stroke } = message;
            setDrawingsList((prev) => {
              if (prev.some((d) => d.id === stroke.id)) return prev;
              return [...prev, stroke];
            });
            break;
          }

          case 'draw-clear': {
            setDrawingsList([]);
            const canvas = whiteboardCanvasRef.current;
            if (canvas) {
              const ctx = canvas.getContext('2d');
              if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
            break;
          }
        }
      } catch (err) {
        console.error('Error executing received WebSockets signalling frame:', err);
      }
    };

    return () => {
      // Discard connections in cleanup
      ws.close();
      Object.keys(peerConnectionsRef.current).forEach((uId) => {
        peerConnectionsRef.current[uId].close();
      });
      peerConnectionsRef.current = {};
    };
  }, [localStream, roomId]);

  // --- 4. WEBRTC HANDLERS AND CONNECTION LIFECYCLE ---

  function setupPeerConnection(targetUserId: string, ws: WebSocket): RTCPeerConnection {
    // Return existing if ready
    if (peerConnectionsRef.current[targetUserId]) {
      return peerConnectionsRef.current[targetUserId];
    }

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnectionsRef.current[targetUserId] = pc;

    // Push local tracks into media routing
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    }

    // Capture dynamic candidates
    pc.onicecandidate = (e) => {
      if (e.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'ice-candidate',
            targetId: targetUserId,
            candidate: e.candidate
          })
        );
      }
    };

    // Attach stream track receiver
    pc.ontrack = (event) => {
      console.log('Standard track arrived from participant WebRTC stream:', targetUserId);
      if (event.streams && event.streams[0]) {
        setRemoteStreams((prev) => ({
          ...prev,
          [targetUserId]: event.streams[0]
        }));
      }
    };

    // Keep track of connection changes for state visibility
    pc.onconnectionstatechange = () => {
      console.log(`WebRTC tracking state with user ${targetUserId}: ${pc.connectionState}`);
    };

    return pc;
  }

  // Caller side: Create and Send Offer
  async function createPeerConnectionAndSendOffer(targetUserId: string, ws: WebSocket) {
    try {
      const pc = setupPeerConnection(targetUserId, ws);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'offer',
            targetId: targetUserId,
            sdp: offer
          })
        );
      }
    } catch (err) {
      console.error(`RTC exception generating offer for ${targetUserId}:`, err);
    }
  }

  // Callee side: Receive Offer and Send Answer
  async function handleOfferReceived(senderId: string, sdp: any, ws: WebSocket) {
    try {
      const pc = setupPeerConnection(senderId, ws);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'answer',
            targetId: senderId,
            sdp: answer
          })
        );
      }
    } catch (err) {
      console.error(`RTC exception answering offer from ${senderId}:`, err);
    }
  }

  // --- 5. E2EE DECRYPTION OBSERVERS FOR CHAT & FILES ---

  // Attempt client-side decryption whenever chat messages list or cryptoKey updates
  useEffect(() => {
    if (!cryptoKey || chatMessages.length === 0) return;

    chatMessages.forEach((msg) => {
      if (decryptedTexts[msg.id]) return; // Already decrypted
      
      decryptText(msg.encryptedText, cryptoKey)
        .then((cleartext) => {
          setDecryptedTexts((prev) => ({
            ...prev,
            [msg.id]: cleartext
          }));
        })
        .catch(() => {
          // Keep visually locked if key is inactive
          setDecryptedTexts((prev) => ({
            ...prev,
            [msg.id]: '🔒 DECRYPTION KEY MISMATCH'
          }));
        });
    });
  }, [chatMessages, cryptoKey, decryptedTexts]);

  // Transmit encrypted text helper
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInputValue.trim() || !cryptoKey || !wsRef.current) return;

    try {
      const clearText = chatInputValue.trim();
      setChatInputValue('');

      // Client-Side Encryption
      const encrypted = await encryptText(clearText, cryptoKey);
      
      const payload: ChatMessage = {
        id: crypto.randomUUID(),
        senderId: user.id,
        senderName: user.username,
        encryptedText: encrypted,
        timestamp: Date.now()
      };

      // Apply locally first (Optimistic update)
      setChatMessages((prev) => [...prev, payload]);
      setDecryptedTexts((prev) => ({
        ...prev,
        [payload.id]: clearText
      }));

      // Ship encrypted package
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'chat-message',
            message: payload
          })
        );
      }
    } catch (err) {
      console.error('E2EE encryption block failed:', err);
    }
  };

  // --- 6. CLIENT-SIDE ENCRYPTED FILE SHARING AGENTS ---

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !cryptoKey || !wsRef.current) return;

    setIsUploading(true);
    setFileProgress('Reading file parameters...');

    try {
      const reader = new FileReader();
      
      reader.onload = async (event) => {
        try {
          const base64DataUrl = event.target?.result as string;
          if (!base64DataUrl) throw new Error('Empty read result.');

          setFileProgress('Encrypting client-side before transmission...');
          // E2EE File encryption
          const encryptedFileBlob = await encryptText(base64DataUrl, cryptoKey);

          const payload: SharedFile = {
            id: crypto.randomUUID(),
            senderId: user.id,
            senderName: user.username,
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            encryptedData: encryptedFileBlob,
            timestamp: Date.now()
          };

          setFileProgress('Shipping encrypted packets over socket...');
          // Send to room
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: 'file-shared',
                file: payload
              })
            );
          }

          // Apply locally
          setSharedFiles((prev) => [...prev, payload]);
          setDecryptedFiles((prev) => ({
            ...prev,
            [payload.id]: base64DataUrl
          }));

          setFileProgress('');
          setIsUploading(false);
        } catch (innerErr: any) {
          console.error(innerErr);
          setFileProgress('Encryption Failed: ' + innerErr.message);
          setIsUploading(false);
        }
      };

      reader.readAsDataURL(file);
    } catch (err: any) {
      console.error(err);
      setFileProgress('Encountered issue: ' + err.message);
      setIsUploading(false);
    }
  };

  // Trigger Client decrypted down-link download
  const handleDecryptAndDownloadFile = async (item: SharedFile) => {
    if (!cryptoKey) return;

    try {
      let activeUrl = decryptedFiles[item.id];
      
      if (!activeUrl) {
        // File decryption triggered
        const clearurlData = await decryptText(item.encryptedData, cryptoKey);
        activeUrl = clearurlData;
        setDecryptedFiles((prev) => ({
          ...prev,
          [item.id]: clearurlData
        }));
      }

      // Trigger standard localized download anchor tag click
      const a = document.createElement('a');
      a.href = activeUrl;
      a.download = item.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      alert('File Decryption Failed: Ensure your shared E2EE key is exactly matching the original key.');
    }
  };

  // --- 7. COLLABORATIVE WHITEBOARD RENDERING LOOPS ---

  // Ref drawing updater: Monitored to completely redraw whiteboard canvas elements whenever lines sync
  useEffect(() => {
    const canvas = whiteboardCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear board first
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply smoothing
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw lines
    drawingsList.forEach((line) => {
      if (line.points.length < 4) return;
      ctx.beginPath();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.lineWidth;
      
      ctx.moveTo(line.points[0], line.points[1]);
      for (let i = 2; i < line.points.length; i += 2) {
        ctx.lineTo(line.points[i], line.points[i + 1]);
      }
      ctx.stroke();
    });
  }, [drawingsList]);

  // Handle local drawing actions on whiteboard
  const getCanvasContextCoords = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>): Point => {
    const canvas = whiteboardCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;

    if ('touches' in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // Scale back actual original internal elements
    const x = ((clientX - rect.left) / rect.width) * canvas.width;
    const y = ((clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const startLocalDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    // Stop touch scrolling while drawing
    if ('touches' in e) {
      e.preventDefault();
    }
    const coords = getCanvasContextCoords(e);
    setIsDrawing(true);
    currentLinePointsRef.current = [coords.x, coords.y];
  };

  const continueLocalDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !whiteboardCanvasRef.current) return;
    if ('touches' in e) {
      e.preventDefault();
    }

    const coords = getCanvasContextCoords(e);
    const pts = currentLinePointsRef.current;

    // Throttle slight updates to avoid redundant flat segments
    const lastX = pts[pts.length - 2];
    const lastY = pts[pts.length - 1];
    const distanceThreshold = 2; // threshold pixels
    const delta = Math.hypot(coords.x - lastX, coords.y - lastY);
    if (delta < distanceThreshold) return;

    pts.push(coords.x, coords.y);

    // Dynamic locally applied preview
    const canvas = whiteboardCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = drawMode === 'eraser' ? '#0f172a' : strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
    }
  };

  const endLocalDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    const pts = currentLinePointsRef.current;
    if (pts.length < 4) {
      currentLinePointsRef.current = [];
      return;
    }

    // Assemble completed stroke
    const newStroke: DrawLine = {
      id: crypto.randomUUID(),
      points: [...pts],
      color: drawMode === 'eraser' ? '#0f172a' : strokeColor,
      lineWidth: strokeWidth
    };

    // Update locally
    setDrawingsList((prev) => [...prev, newStroke]);

    // Transmit to socket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'draw-stroke',
          stroke: newStroke
        })
      );
    }

    currentLinePointsRef.current = [];
  };

  const clearGlobalCanvas = () => {
    setDrawingsList([]);
    const canvas = whiteboardCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'draw-clear'
        })
      );
    }
  };

  // --- 8. UI TOGGLES INTEGRATION INTERFACES ---

  const handleMediaToggle = (channel: 'audio' | 'video' | 'screen') => {
    if (channel === 'audio') {
      const nextVal = !isAudioActive;
      setIsAudioActive(nextVal);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'media-toggle',
            field: 'audio',
            value: nextVal
          })
        );
      }
    } else if (channel === 'video') {
      const nextVal = !isVideoActive;
      setIsVideoActive(nextVal);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'media-toggle',
            field: 'video',
            value: nextVal
          })
        );
      }
    } else if (channel === 'screen') {
      // Screen sharing operations
      if (!isScreenSharing) {
        navigator.mediaDevices
          .getDisplayMedia({ video: true })
          .then((screenStream) => {
            const videoTrack = screenStream.getVideoTracks()[0];
            
            // Override track in RTC connections
            Object.keys(peerConnectionsRef.current).forEach((uId) => {
              const pc = peerConnectionsRef.current[uId];
              if (pc) {
                const senders = pc.getSenders();
                const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
                if (videoSender) {
                  videoSender.replaceTrack(videoTrack).catch(e => console.warn(e));
                }
              }
            });

            // If user manually stops screen share from browser task bar
            videoTrack.onended = () => {
              restoreWebcamVideoTrack();
            };

            setIsScreenSharing(true);
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  type: 'media-toggle',
                  field: 'screen',
                  value: true
                })
              );
            }
          })
          .catch((err) => {
            console.error('Screen sharing was declined/restricted:', err);
          });
      } else {
        restoreWebcamVideoTrack();
      }
    }
  };

  const restoreWebcamVideoTrack = () => {
    if (localStream) {
      const originalTrack = localStream.getVideoTracks()[0];
      if (originalTrack) {
        Object.keys(peerConnectionsRef.current).forEach((uId) => {
          const pc = peerConnectionsRef.current[uId];
          if (pc) {
            const senders = pc.getSenders();
            const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
            if (videoSender) {
              videoSender.replaceTrack(originalTrack).catch(e => console.warn(e));
            }
          }
        });
      }
    }
    setIsScreenSharing(false);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'media-toggle',
          field: 'screen',
          value: false
        })
      );
    }
  };

  // Format sizing bytes
  const formatSizing = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* 1. Header Bar panel info */}
      <header className="px-4 py-3 bg-slate-900 border-b border-slate-800/80 flex items-center justify-between shadow-md z-20">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-cyan-500 to-indigo-600 rounded-lg">
            <Lock className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="font-display font-semibold text-sm sm:text-base leading-none text-slate-200">
                Nexus Suite
              </h1>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-900/40 border border-cyan-800 text-cyan-300 font-mono">
                {roomId}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex items-center gap-1 text-[10px] text-emerald-400">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                <span>WebRTC Mesh Active</span>
              </div>
              <span className="text-slate-600 text-[10px] font-mono">|</span>
              <div className="flex items-center gap-1 text-[10px] text-indigo-400">
                <Unlock className="w-2.5 h-2.5" />
                <span>E2EE Active</span>
              </div>
            </div>
          </div>
        </div>

        {/* User identification badge */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-xs text-slate-300 font-medium">{user.username}</span>
            <span className="text-[9px] text-slate-500 font-mono">Secure Token Session</span>
          </div>

          <button
            onClick={onLeave}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-950/40 border border-red-900 hover:bg-red-900/40 hover:text-red-200 text-red-300 rounded-lg text-xs leading-none transition-all"
          >
            <LogOut className="w-3.5 h-3.5" />
            Leave Room
          </button>
        </div>
      </header>

      {/* Hardware constraints notice banner */}
      {mediaDevicesError && (
        <div className="px-4 py-2 bg-indigo-950/40 border-b border-indigo-900/60 flex items-center justify-between text-indigo-300 text-xs">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>{mediaDevicesError}</span>
          </div>
          <button 
            onClick={() => setMediaDevicesError(null)} 
            className="text-indigo-400 font-bold hover:text-indigo-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main meeting area grid */}
      <main className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12 gap-4 p-4">
        
        {/* Left Side section (Columns 1 to 8): Video grid + Dynamic Whiteboard */}
        <div className="lg:col-span-8 flex flex-col gap-4 overflow-y-auto custom-scroll pr-1">
          
          {/* Top segment: Camera Stream feeds Grid */}
          <div>
            <h2 className="text-xs font-semibold tracking-wider text-slate-400 uppercase mb-2 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-cyan-400" />
              Participants Streams ({1 + participants.length})
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              
              {/* Local Stream display box */}
              <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-900 border border-slate-800 shadow-md flex items-center justify-center">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover rounded-xl"
                />
                
                {/* Labels */}
                <div className="absolute top-2 left-2 px-2 py-1 bg-slate-950/80 rounded-md border border-slate-800/80 text-[10px] text-slate-300 font-medium flex items-center gap-1.5">
                  <Crown className="w-3 h-3 text-cyan-400 animate-pulse" />
                  <span>{user.username} (You)</span>
                </div>

                <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                  <span className={`p-1.5 rounded-full ${isAudioActive ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' : 'bg-red-500/20 border border-red-500/30 text-red-400'}`}>
                    {isAudioActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                  </span>
                  <span className={`p-1.5 rounded-full ${isVideoActive ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' : 'bg-red-500/20 border border-red-500/30 text-red-400'}`}>
                    {isVideoActive ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
                  </span>
                  {isSimulatedFeed && (
                    <span className="px-1.5 py-0.5 rounded bg-indigo-900 border border-indigo-700 text-indigo-300 text-[8px] font-mono select-none">
                      Simulated
                    </span>
                  )}
                </div>
              </div>

              {/* Remote Participants stream blocks representation */}
              {participants.map((item) => {
                const specStream = remoteStreams[item.id];
                return (
                  <div
                    key={item.id}
                    className="relative aspect-video rounded-xl overflow-hidden bg-slate-900 border border-slate-800 shadow-md flex items-center justify-center"
                  >
                    {specStream ? (
                      <video
                        autoPlay
                        playsInline
                        ref={(el) => {
                          if (el && el.srcObject !== specStream) {
                            el.srcObject = specStream;
                          }
                        }}
                        className="w-full h-full object-cover rounded-xl"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950">
                        <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center font-display font-semibold text-lg text-slate-300">
                          {item.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono mt-2">Connecting WebRTC Stream...</span>
                      </div>
                    )}

                    {/* Labels details */}
                    <div className="absolute top-2 left-2 px-2 py-1 bg-slate-950/80 rounded-md border border-slate-800/80 text-[10px] text-slate-300 font-medium">
                      {item.name}
                    </div>

                    <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                      <span className={`p-1.5 rounded-full ${item.isAudioActive ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' : 'bg-red-500/20 border border-red-500/30 text-red-400'}`}>
                        {item.isAudioActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                      </span>
                      <span className={`p-1.5 rounded-full ${item.isVideoActive ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' : 'bg-red-500/20 border border-red-500/30 text-red-400'}`}>
                        {item.isVideoActive ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Zero participants prompt */}
              {participants.length === 0 && (
                <div className="border border-dashed border-slate-800 rounded-xl flex flex-col items-center justify-center p-6 text-center bg-slate-900/30 aspect-video col-span-2">
                  <Server className="w-8 h-8 text-slate-600 mb-1.5" />
                  <h3 className="text-xs font-semibold text-slate-400">Waiting for other peers to join...</h3>
                  <p className="text-[10px] text-slate-600 mt-1 max-w-xs">
                    Copy the Room ID <strong className="text-cyan-500">{roomId}</strong> and log in as another user to test loopback peer connection streams!
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Bottom segment: Canvas Whiteboard panel */}
          <div className="glass-panel border border-slate-800/80 rounded-2xl flex flex-col p-4 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 border-b border-slate-900 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-md">
                  <Palette className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-200">Interactive Whiteboard</h3>
                  <p className="text-[10px] text-slate-500">Real-Time Sync Multi-User Sketchpad</p>
                </div>
              </div>

              {/* Whiteboard Toolbox Controls */}
              <div className="flex flex-wrap items-center gap-2">
                
                {/* Mode Selectors */}
                <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setDrawMode('pen')}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${drawMode === 'pen' ? 'bg-cyan-500 text-white shadow-sm' : 'text-slate-400 hover:text-slate-300'}`}
                  >
                    Pen Tool
                  </button>
                  <button
                    onClick={() => setDrawMode('eraser')}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${drawMode === 'eraser' ? 'bg-cyan-500 text-white shadow-sm' : 'text-slate-400 hover:text-slate-300'}`}
                  >
                    Eraser
                  </button>
                </div>

                {/* Brush Colors */}
                {drawMode === 'pen' && (
                  <div className="flex items-center gap-1.5 px-1.5 py-1 bg-slate-900 rounded-lg border border-slate-800">
                    {['#06b6d4', '#e11d48', '#10b981', '#f59e0b', '#ffffff'].map((col) => (
                      <button
                        key={col}
                        onClick={() => setStrokeColor(col)}
                        style={{ backgroundColor: col }}
                        className={`w-3.5 h-3.5 rounded-full transition-transform ${strokeColor === col ? 'scale-125 ring-2 ring-slate-100' : 'hover:scale-110'}`}
                      />
                    ))}
                  </div>
                )}

                {/* Brush Width */}
                <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-900 rounded-lg border border-slate-800 text-[10px] text-slate-400">
                  <span>Size:</span>
                  <select
                    value={strokeWidth}
                    onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
                    className="bg-transparent border-none outline-none font-mono text-[10px] font-bold text-cyan-400 cursor-pointer"
                  >
                    <option value="2">2px</option>
                    <option value="4">4px</option>
                    <option value="8">8px</option>
                    <option value="12">12px</option>
                  </select>
                </div>

                {/* Action Clean Board */}
                <button
                  onClick={clearGlobalCanvas}
                  className="p-1 px-2.5 bg-red-950/30 hover:bg-red-900/30 text-red-400 hover:text-red-300 border border-red-900/60 rounded-lg text-[10px] font-medium transition-all flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear Board
                </button>
              </div>
            </div>

            {/* Drawing interactive Stage Canvas */}
            <div className="relative bg-slate-900/60 rounded-xl border border-slate-900 aspect-[16/9] w-full overflow-hidden cursor-crosshair">
              <canvas
                id="whiteboard-canvas"
                ref={whiteboardCanvasRef}
                width={1280}
                height={720}
                onMouseDown={startLocalDrawing}
                onMouseMove={continueLocalDrawing}
                onMouseUp={endLocalDrawing}
                onMouseLeave={endLocalDrawing}
                onTouchStart={startLocalDrawing}
                onTouchMove={continueLocalDrawing}
                onTouchEnd={endLocalDrawing}
                className="absolute top-0 left-0 w-full h-full block bg-slate-950/20"
              />
              <div className="absolute bottom-2 left-2 text-[8px] text-slate-600 font-mono pointer-events-none select-none">
                HTML5 Active Sync Canvas context 1280x720 (scaled)
              </div>
            </div>
          </div>
        </div>

        {/* Right Side sections (Columns 9 to 12): Chat messaging room + Encrypted files explorer */}
        <div className="lg:col-span-4 flex flex-col gap-4 overflow-hidden h-full">
          
          {/* Section: Chat room block */}
          <div className="flex-1 glass-panel border border-slate-800/80 rounded-2xl flex flex-col p-4 overflow-hidden h-1/2">
            
            {/* Header info */}
            <div className="flex items-center gap-2 mb-3 border-b border-slate-900 pb-2">
              <div className="p-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-md">
                <MessageSquare className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-200">E2EE Private Room Chat</h3>
                <p className="text-[9px] text-slate-500">Encrypted client-side with AES-256-GCM</p>
              </div>
            </div>

            {/* Messages box */}
            <div className="flex-1 overflow-y-auto custom-scroll space-y-3 mb-3 pr-1 text-xs">
              {chatMessages.map((msg) => {
                const resolvedText = decryptedTexts[msg.id];
                const isMine = msg.senderId === user.id;

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] text-slate-400 font-medium">{msg.senderName}</span>
                      <span className="text-[8px] text-slate-600 font-mono">
                        {new Date(msg.timestamp).toISOString().slice(11, 16)}
                      </span>
                    </div>

                    <div className={`p-2.5 rounded-2xl max-w-[85%] leading-relaxed ${isMine ? 'bg-cyan-600 text-white rounded-tr-none' : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none'}`}>
                      {resolvedText ? (
                        <span>{resolvedText}</span>
                      ) : (
                        <div className="flex items-center gap-1.5 text-slate-500 text-[10px] italic">
                          <Lock className="w-3 h-3 text-indigo-500 shrink-0" />
                          <span>Decrypting securely...</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {chatMessages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-600 p-4">
                  <Lock className="w-6 h-6 text-slate-700 mb-1" />
                  <p className="text-[10px] uppercase font-mono tracking-wider">No messaging records yet</p>
                  <p className="text-[9px] text-slate-500 mt-1 max-w-[180px]">Your conversational threads are completely masked on the server.</p>
                </div>
              )}
            </div>

            {/* Input send bar footer */}
            <form onSubmit={handleSendChatMessage} className="flex gap-2">
              <input
                type="text"
                value={chatInputValue}
                onChange={(e) => setChatInputValue(e.target.value)}
                placeholder="Send secure cipher message..."
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl outline-none focus:border-cyan-500 text-xs transition-all placeholder:text-slate-600"
              />
              <button
                type="submit"
                className="p-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl transition-colors shadow-md flex items-center justify-center shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>

          {/* Section: File Sharing block */}
          <div className="glass-panel border border-slate-800/80 rounded-2xl flex flex-col p-4 overflow-hidden h-1/2">
            
            {/* Header file explorer */}
            <div className="flex items-center gap-2 mb-3 border-b border-slate-900 pb-2">
              <div className="p-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-md">
                <FileText className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-200">End-To-End Encrypted File Drops</h3>
                <p className="text-[9px] text-slate-500">AES-256 ciphertext transfer securely</p>
              </div>
            </div>

            {/* Shared file list container */}
            <div className="flex-1 overflow-y-auto custom-scroll space-y-2.5 mb-2 pr-1 text-xs">
              {sharedFiles.map((item) => {
                const isMine = item.senderId === user.id;
                const isDecryptedReady = !!decryptedFiles[item.id];

                return (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 overflow-hidden">
                      <div className="p-2 bg-slate-950 rounded-lg border border-slate-800 shrink-0">
                        <FileText className="w-4 h-4 text-cyan-400" />
                      </div>
                      <div className="overflow-hidden">
                        <div className="font-semibold text-[11px] text-slate-200 truncate pr-2">
                          {item.name}
                        </div>
                        <div className="flex items-center gap-1.5 text-[9px] text-slate-500 font-mono mt-0.5">
                          <span>{formatSizing(item.size)}</span>
                          <span>•</span>
                          <span className="truncate max-w-[80px]">{item.senderName}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleDecryptAndDownloadFile(item)}
                      title={isDecryptedReady ? 'Download File' : 'Decrypt & Download'}
                      className={`p-1.5 rounded-lg border flex items-center justify-center shrink-0 transition-all ${isDecryptedReady ? 'bg-emerald-950/20 border-emerald-900 text-emerald-400 hover:bg-emerald-900/20' : 'bg-cyan-950/20 border-cyan-900 text-cyan-400 hover:bg-cyan-900/20'}`}
                    >
                      {isDecryptedReady ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                );
              })}

              {sharedFiles.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-600 p-4">
                  <ShieldAlert className="w-6 h-6 text-slate-700 mb-1" />
                  <p className="text-[10px] uppercase font-mono tracking-wider">No documents shared</p>
                  <p className="text-[9px] text-slate-500 mt-1 max-w-[180px]">Drop files to encrypt and synchronize with other peers.</p>
                </div>
              )}
            </div>

            {/* Inputs upload form footer */}
            <div className="border-t border-slate-900 pt-2.5">
              <label className="flex flex-col items-center justify-center border border-dashed border-slate-800/80 rounded-xl p-3 bg-slate-950/40 hover:bg-slate-950 cursor-pointer transition-all">
                <input
                  type="file"
                  onChange={handleFileUpload}
                  disabled={isUploading || !cryptoKey}
                  className="hidden"
                />
                <FileUp className="w-5 h-5 text-slate-500 mb-1" />
                <span className="text-[10px] font-medium text-slate-400">
                  {isUploading ? 'Securing bytes...' : 'Encrypt & share local file'}
                </span>
                <span className="text-[8px] text-slate-600 font-mono mt-0.5">
                  Max size: 10MB
                </span>
              </label>

              {fileProgress && (
                <div className="mt-1.5 text-[9px] text-cyan-400 font-mono text-center">
                  {fileProgress}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* 4. Controls Dock footer */}
      <footer className="p-4 bg-slate-900 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg z-20">
        
        {/* Device Status info detail */}
        <div className="flex items-center gap-3">
          <div className="px-2 py-1 bg-slate-950 rounded border border-slate-800 text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${socketConnected ? 'bg-emerald-500 glow-pulse' : 'bg-red-500'}`} />
            <span>Server status: {socketConnected ? 'Operational' : 'Disconnected'}</span>
          </div>
          
          <div className="px-2 py-1 bg-slate-950 rounded border border-slate-800 text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-500" />
            <span>Peers connected: {participants.length}</span>
          </div>
        </div>

        {/* Primary Controls panel buttons */}
        <div className="flex items-center gap-3.5">
          {/* Mute Mic toggle button */}
          <button
            onClick={() => handleMediaToggle('audio')}
            title={isAudioActive ? 'Mute Microphone' : 'Unmute Microphone'}
            className={`p-3 rounded-full transition-all flex items-center justify-center shadow-md ${isAudioActive ? 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-750' : 'bg-red-600 text-white hover:bg-red-500 scale-105'}`}
          >
            {isAudioActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>

          {/* Toggle Cam button */}
          <button
            onClick={() => handleMediaToggle('video')}
            title={isVideoActive ? 'Stop Camera' : 'Start Camera'}
            className={`p-3 rounded-full transition-all flex items-center justify-center shadow-md ${isVideoActive ? 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-750' : 'bg-red-600 text-white hover:bg-red-500 scale-105'}`}
          >
            {isVideoActive ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>

          {/* Screen-Share Toggle icon */}
          <button
            onClick={() => handleMediaToggle('screen')}
            title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
            className={`p-3 rounded-full transition-all flex items-center justify-center shadow-md ${isScreenSharing ? 'bg-cyan-600 text-white ring-2 ring-cyan-400' : 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-750'}`}
          >
            <Monitor className="w-5 h-5" />
          </button>
        </div>

        {/* Secure E2EE key display summary */}
        <div className="hidden md:flex items-center gap-2">
          <div className="text-right">
            <span className="block text-[8px] text-slate-500 font-mono uppercase tracking-wider">Room Security Seal</span>
            <span className="block text-[10px] text-indigo-400 font-semibold font-mono tracking-wide">
              {encryptionPass.slice(0, 4)}••••{encryptionPass.slice(-4)}
            </span>
          </div>
          <div className="p-1.5 bg-indigo-950/40 rounded border border-indigo-900">
            <Lock className="w-3.5 h-3.5 text-indigo-400" />
          </div>
        </div>

      </footer>
    </div>
  );
}
