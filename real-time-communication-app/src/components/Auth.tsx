/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ShieldCheck, User as UserIcon, Lock, Users, Key, MonitorPlay, Sparkles } from 'lucide-react';

interface AuthProps {
  onAuthenticated: (
    user: { id: string; username: string },
    token: string,
    roomId: string,
    encryptionPass: string,
    mediaConfig: { audio: boolean; video: boolean; forceSimulate: boolean }
  ) => void;
}

export default function Auth({ onAuthenticated }: AuthProps) {
  // Navigation states
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Auth User state
  const [authUser, setAuthUser] = useState<{ id: string; username: string } | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

  // Target meeting config state
  const [roomId, setRoomId] = useState('nexus-lounge');
  const [passphrase, setPassphrase] = useState('NexusSuperSecureSecretPass');
  const [audioInput, setAudioInput] = useState(true);
  const [videoInput, setVideoInput] = useState(true);
  const [simulateVideo, setSimulateVideo] = useState(false);

  // Auto detect active session on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('nexus_token');
    if (storedToken) {
      setIsLoading(true);
      fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${storedToken}`
        }
      })
        .then((res) => {
          if (!res.ok) throw new Error('Session expired');
          return res.json();
        })
        .then((userData) => {
          setAuthUser({ id: userData.id, username: userData.username });
          setAuthToken(storedToken);
          setMessage(`Welcome back, ${userData.username}! Session unlocked.`);
        })
        .catch((err) => {
          console.log('No prior active session found:', err.message);
          localStorage.removeItem('nexus_token');
        })
        .finally(() => setIsLoading(false));
    }
  }, []);

  // Form submission: Register or Login
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setIsLoading(true);

    if (!username.trim() || !password.trim()) {
      setError('Please provide both username and password.');
      setIsLoading(false);
      return;
    }

    const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password: password.trim()
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Identity verification failed.');
      }

      localStorage.setItem('nexus_token', data.token);
      setAuthUser(data.user);
      setAuthToken(data.token);
      setMessage(data.message || 'Authenticated successfully.');
      setPassword('');
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  // Signout handler
  const handleSignOut = async () => {
    if (authToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });
      } catch (err) {
        console.error('Logout error:', err);
      }
    }
    localStorage.removeItem('nexus_token');
    setAuthUser(null);
    setAuthToken(null);
    setMessage('Signed out securely.');
  };

  // Connect to room handler
  const handleConnectToMeeting = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser || !authToken) return;
    if (!roomId.trim()) {
      setError('A valid Room ID is required to launch.');
      return;
    }
    if (!passphrase.trim()) {
      setError('End-to-End Encryption passphrase cannot be blank.');
      return;
    }

    onAuthenticated(authUser, authToken, roomId.trim().toLowerCase(), passphrase, {
      audio: audioInput,
      video: videoInput,
      forceSimulate: simulateVideo,
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Visual Ambient BG */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-600/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-lg z-10 glass-panel border border-slate-800/80 rounded-2xl shadow-2xl p-6 sm:p-8 backdrop-blur-md">
        
        {/* Banner Headers */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-cyan-500 to-indigo-600 rounded-2xl shadow-indigo-500/20 shadow-md mb-3">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Nexus RTC
          </h1>
          <p className="text-xs text-slate-400 font-mono tracking-wide uppercase mt-1">
            Secure Full-Stack Meeting Suite
          </p>
          <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            End-to-End Encrypted (AES-GCM-256)
          </div>
        </div>

        {/* Notices */}
        {error && (
          <div className="mb-4 p-3.5 rounded-lg bg-red-950/40 border border-red-800/80 text-red-300 text-xs text-center">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-4 p-3.5 rounded-lg bg-emerald-950/40 border border-emerald-800/80 text-emerald-300 text-xs text-center">
            {message}
          </div>
        )}

        {/* Step 1: Secure Credentials Auth Profile */}
        {!authUser ? (
          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <h2 className="text-sm font-semibold tracking-wide text-slate-300 uppercase mb-2 text-center">
              {isRegisterMode ? 'Generate Credentials Key' : 'Account Access credentials'}
            </h2>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-400">Username/Alias</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                  <UserIcon className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. dev_commander"
                  required
                  disabled={isLoading}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none text-sm text-slate-100 transition-all placeholder:text-slate-600"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-400">Secure Password</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                  <Lock className="w-4 h-4" />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="•••••••••"
                  required
                  disabled={isLoading}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none text-sm text-slate-100 transition-all placeholder:text-slate-600"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 py-3 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-medium text-sm rounded-xl transition-all shadow-md active:scale-[0.99] disabled:opacity-50"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  Hashing & Verifying...
                </span>
              ) : isRegisterMode ? (
                'Register & Unlock Server Account'
              ) : (
                'Login with Secure Key'
              )}
            </button>

            <div className="text-center pt-3 border-t border-slate-900 mt-4">
              <button
                type="button"
                onClick={() => {
                  setIsRegisterMode(!isRegisterMode);
                  setError(null);
                  setMessage(null);
                }}
                className="text-xs text-cyan-400 hover:text-cyan-300 hover:underline transition-all"
              >
                {isRegisterMode ? 'Already have credentials? Sign in instead' : 'Need active user key? Register new server account'}
              </button>
            </div>
          </form>
        ) : (
          /* Step 2: Set Meeting Config */
          <form onSubmit={handleConnectToMeeting} className="space-y-5">
            <div className="flex items-center justify-between bg-slate-900/60 p-3 rounded-lg border border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                <div className="text-xs text-slate-300">
                  Session Token: <span className="font-mono text-cyan-400">Active</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 hover:text-red-300 rounded border border-slate-700 text-slate-400 transition-all"
              >
                Sign out
              </button>
            </div>

            <h2 className="text-xs font-semibold tracking-wide text-slate-400 uppercase mt-2">
              Launch Collaborative Room Settings
            </h2>

            {/* Room Identifier */}
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-400">Room Identifier</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                  <Users className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="nexus-lounge"
                  required
                  className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none text-sm text-slate-100 transition-all"
                />
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Connects peers joining under the same room name.
              </p>
            </div>

            {/* End to End Passphrase */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-slate-400">E2EE Security Passphrase</label>
                <span className="text-[10px] text-indigo-400 font-mono">Client-Side Key</span>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-indigo-500">
                  <Key className="w-4 h-4 animate-pulse" />
                </span>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Secret Room Key"
                  required
                  className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-sm text-slate-100 transition-all font-mono"
                />
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                <strong className="text-indigo-400">Strict Privacy:</strong> Chat strings and files are AES-encrypted before shipping. The server remains blind.
              </p>
            </div>

            {/* Hard-toggle hardware stream features */}
            <div className="space-y-2 border-t border-slate-900 pt-3">
              <label className="block text-xs font-medium text-slate-400">Media Device Configuration</label>
              
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 p-2.5 bg-slate-900/60 border border-slate-800/80 rounded-lg cursor-pointer hover:bg-slate-900 transition-all">
                  <input
                    type="checkbox"
                    checked={audioInput}
                    onChange={(e) => setAudioInput(e.target.checked)}
                    className="accent-cyan-500 rounded text-cyan-500 focus:ring-slate-900"
                  />
                  <span className="text-xs text-slate-300">Mic Active</span>
                </label>
                
                <label className="flex items-center gap-2 p-2.5 bg-slate-900/60 border border-slate-800/80 rounded-lg cursor-pointer hover:bg-slate-900 transition-all">
                  <input
                    type="checkbox"
                    checked={videoInput}
                    onChange={(e) => setVideoInput(e.target.checked)}
                    className="accent-cyan-500 rounded text-cyan-500 focus:ring-slate-900"
                  />
                  <span className="text-xs text-slate-300">Camera Active</span>
                </label>
              </div>

              {/* Simulated Camera Toggle Option */}
              <div className="p-3 bg-slate-900/40 rounded-xl border border-indigo-950/80 mt-1">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simulateVideo}
                    onChange={(e) => setSimulateVideo(e.target.checked)}
                    className="accent-indigo-500 rounded text-indigo-500 focus:ring-slate-900 mt-0.5"
                  />
                  <div>
                    <span className="text-xs font-semibold text-slate-200 block flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400 inline" />
                      Fallback Simulated Media Feed
                    </span>
                    <span className="text-[10px] text-slate-400 leading-normal block mt-0.5">
                      Check this to stream a gorgeous glowing canvas avatar instead of a webcam. Solves browser sandbox or iframe camera permission blocks!
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-semibold text-sm rounded-xl transition-all shadow-lg active:scale-[0.99] flex items-center justify-center gap-2"
            >
              <MonitorPlay className="w-4 h-4" />
              Join Encrypted Workspace
            </button>
          </form>
        )}
      </div>

      <div className="mt-8 text-center text-[10px] text-slate-600 max-w-sm leading-relaxed pointer-events-none">
        Secure Full-Stack Node Express & TLS Signaling System. Credential database is persistent server-side via hash verified salts on the local filesystem.
      </div>
    </div>
  );
}
