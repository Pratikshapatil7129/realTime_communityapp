/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { EncryptedPayload } from '../types';

// Convert simple ArrayBuffer to Base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Convert Base64 to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Derives a raw CryptoKey (AES-GCM-256) from a user-supplied room passphrase
 */
export async function deriveKey(passphrase: string, roomId: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const rawKeyData = encoder.encode(passphrase);
  
  // Create a base cryptographic key from the passphrase
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    rawKeyData,
    { name: 'PBKDF2' },
    false,
    ['deriveKey', 'deriveBits']
  );
  
  // Use Room ID as the salt to ensure keys differ across meeting rooms even with the same passphrase
  const salt = encoder.encode(`NexusRTC_salt_${roomId}`);
  
  // Derive a strong 256-bit AES-GCM key
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // key is non-extractable for added runtime security
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts cleartext string using derived AES-GCM key
 */
export async function encryptText(text: string, key: CryptoKey): Promise<EncryptedPayload> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  
  // Generate a random 12-byte initialization vector (IV) for AES-GCM
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    data
  );
  
  return {
    cipherText: arrayBufferToBase64(encrypted),
    iv: arrayBufferToBase64(iv),
  };
}

/**
 * Decrypts encrypted payload into cleartext.
 * Returns null or throws if decryption fails (e.g. incorrect key).
 */
export async function decryptText(payload: EncryptedPayload, key: CryptoKey): Promise<string> {
  try {
    const data = base64ToArrayBuffer(payload.cipherText);
    const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
    
    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      key,
      data
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (err) {
    console.error('Decryption failed, incorrect passphrase?', err);
    throw new Error('DECRYPTION_FAILED');
  }
}
