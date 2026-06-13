/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import Auth from './components/Auth';
import MeetingRoom from './components/MeetingRoom';

export default function App() {
  // Session details stored after register / login success
  const [currentUser, setCurrentUser] = useState<{ id: string; username: string } | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  
  // Meeting Config states
  const [targetRoomId, setTargetRoomId] = useState<string | null>(null);
  const [encryptionPassphrase, setEncryptionPassphrase] = useState<string | null>(null);
  const [mediaSettings, setMediaSettings] = useState<{ audio: boolean; video: boolean; forceSimulate: boolean }>({
    audio: true,
    video: true,
    forceSimulate: false,
  });

  const handleAuthenticated = (
    user: { id: string; username: string },
    token: string,
    roomId: string,
    passphrase: string,
    mediaConfig: { audio: boolean; video: boolean; forceSimulate: boolean }
  ) => {
    setCurrentUser(user);
    setAuthToken(token);
    setTargetRoomId(roomId);
    setEncryptionPassphrase(passphrase);
    setMediaSettings(mediaConfig);
  };

  const handleLeaveMeeting = () => {
    setTargetRoomId(null);
    setEncryptionPassphrase(null);
  };

  return (
    <div id="app-root-container" className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {currentUser && targetRoomId && encryptionPassphrase ? (
        <MeetingRoom
          user={currentUser}
          roomId={targetRoomId}
          encryptionPass={encryptionPassphrase}
          mediaConfig={mediaSettings}
          onLeave={handleLeaveMeeting}
        />
      ) : (
        <Auth onAuthenticated={handleAuthenticated} />
      )}
    </div>
  );
}
