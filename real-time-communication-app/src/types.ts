/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface User {
  id: string;
  name: string;
  joinedAt: number;
  isAudioActive: boolean;
  isVideoActive: boolean;
  isScreenSharing: boolean;
  isSimulatedStream?: boolean; // True if using virtual webcam fallback in sandbox
}

export interface EncryptedPayload {
  cipherText: string;
  iv: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  encryptedText: EncryptedPayload;
  timestamp: number;
}

export interface SharedFile {
  id: string;
  senderId: string;
  senderName: string;
  name: string;
  type: string;
  size: number;
  encryptedData: EncryptedPayload; // Client-side client-blind encrypted base64 payload
  timestamp: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface DrawLine {
  id: string;
  points: number[]; // Flat array of [x, y, x, y, ...]
  color: string;
  lineWidth: number;
}

export interface RoomState {
  roomId: string;
  users: User[];
  messages: ChatMessage[];
  files: SharedFile[];
  drawings: DrawLine[];
}

// Signaling events for WebRTC peer connection
export type SignalingMessage =
  | { type: 'join'; roomId: string; name: string }
  | { type: 'welcome'; clientList: User[]; yourId: string }
  | { type: 'user-joined'; user: User }
  | { type: 'user-left'; userId: string }
  | { type: 'media-toggle'; userId: string; field: 'audio' | 'video' | 'screen'; value: boolean }
  | { type: 'offer'; senderId: string; targetId: string; sdp: any }
  | { type: 'answer'; senderId: string; targetId: string; sdp: any }
  | { type: 'ice-candidate'; senderId: string; targetId: string; candidate: any }
  | { type: 'chat-message'; message: ChatMessage }
  | { type: 'file-shared'; file: SharedFile }
  | { type: 'draw-stroke'; stroke: DrawLine }
  | { type: 'draw-clear' }
  | { type: 'sync-canvas'; drawings: DrawLine[] };
