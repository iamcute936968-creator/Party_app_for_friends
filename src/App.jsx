import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, set, push, update, onValue, get as fbGet, remove, onDisconnect, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

// Import components and hooks
import Home from './components/Home';
import Room from './components/Room';
import { useWebRTC } from './hooks/useWebRTC';
import { useDriveAuth } from './hooks/useDriveAuth';
import { useDriveVideo } from './hooks/useDriveVideo';
import { useDriveStream } from './hooks/useDriveStream';

// Import adapters
import { createYouTubeAdapter } from './adapters/YouTubeAdapter';
import { createHTML5Adapter } from './adapters/HTML5Adapter';

// Feature flag: Phase 7 Drive HTTP Range streaming
const IS_DRIVE_STREAMING = import.meta.env.VITE_DRIVE_STREAMING === 'true';

// Initialize Firebase
const firebaseConfig = {
  databaseURL: "https://watch-party-app-9fc62-default-rtdb.asia-southeast1.firebasedatabase.app"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app, "https://watch-party-app-9fc62-default-rtdb.asia-southeast1.firebasedatabase.app");

/**
 * Calculate the expected playback position from the reference clock.
 *
 * @param {Object}  rc                Reference-clock snapshot from room
 * @param {string}  rc.playbackState  'PLAYING' | 'PAUSED'
 * @param {number}  rc.anchorTime     Seconds into video when anchor was set
 * @param {number}  rc.updatedAt      Server-epoch-ms when anchor was set
 * @param {number}  serverTimeOffset  Firebase /.info/serverTimeOffset (ms)
 * @returns {number|null}             Expected position in seconds, or null when
 *                                    reference-clock data is not yet valid
 *                                    (triggers legacy fallback on the call site)
 */
const getExpectedPosition = (rc, serverTimeOffset) => {
  if (!rc || !rc.playbackState || typeof rc.anchorTime !== 'number' || !rc.updatedAt) {
    return null;
  }
  if (rc.playbackState === 'PAUSED') {
    return Math.max(0, rc.anchorTime);
  }
  // PLAYING: advance anchorTime by elapsed server time
  const serverNow = Date.now() + serverTimeOffset;
  const elapsedSec = (serverNow - rc.updatedAt) / 1000;
  return Math.max(0, rc.anchorTime + elapsedSec);
};

/**
 * When the authoritative host session is offline while the room playbackState
 * is PLAYING, derive the deterministic frozen position P* and return a
 * synthetic PAUSED room snapshot that normal sync functions can consume without
 * modification.
 *
 * P* formula (PLAYING):
 *   anchorTime + (endedAt - updatedAt) / 1000
 * P* formula (PAUSED):
 *   anchorTime  (room is already at rest)
 *
 * Returns null when:
 *   - no Phase-5 presence data exists (legacy room → fall through to normal sync)
 *   - host session is still online
 *   - room is not PLAYING
 *   - endedAt is missing (onDisconnect not yet executed)
 */
const getHostInterruptedFrozenRoom = (room) => {
  if (!room || !room.hostSessionId) return null;
  const session = room.hostPresence?.[room.hostSessionId];
  if (!session) return null;
  if (session.online === true) return null;
  if (room.playbackState !== 'PLAYING') return null;
  // onDisconnect has not fired yet — endedAt will arrive via onValue later
  if (!session.endedAt) return null;

  let P = room.anchorTime || 0;
  if (room.updatedAt && room.updatedAt > 0) {
    const elapsed = (session.endedAt - room.updatedAt) / 1000;
    if (elapsed > 0) P += elapsed;
  }
  P = Math.max(0, P);

  return {
    ...room,
    playbackState: 'PAUSED',
    anchorTime: P,
    // Use endedAt as the synthetic updatedAt so getExpectedPosition
    // receives a valid, truthy timestamp and returns Math.max(0, P)
    updatedAt: session.endedAt
  };
};

/**
 * If the room is in a stale PLAYING state due to host disconnection, compute
 * P* and write a PAUSED anchor to Firebase. Returns the updated room object
 * (with normalized fields) for the caller to use as local state.
 *
 * Safe to call when:
 *   - reconnecting host wants to normalize before establishing new session
 *   - rejoinAsHost() wants to avoid inheriting a ghost clock
 *
 * No-op when:
 *   - room is already PAUSED
 *   - active host session is online
 *   - no Phase-5 presence data exists (legacy room)
 *   - P* cannot be computed (missing endedAt)
 */
const normalizeRoomIfInterrupted = async (roomId, room) => {
  const frozen = getHostInterruptedFrozenRoom(room);
  if (!frozen) return room; // nothing to normalize

  const P = frozen.anchorTime;
  try {
    await update(ref(db, '/rooms/' + roomId), {
      // Reference-clock fields
      playbackState: 'PAUSED',
      anchorTime: P,
      updatedAt: serverTimestamp(),
      // Legacy fields
      isPlaying: false,
      currentTime: P,
      // Clear stale session pointer
      hostSessionId: null
    });
  } catch (err) {
    console.error('[Phase 5] Failed to normalize interrupted room; host reconnect aborted.', err);
    throw err;
  }

  // Return the normalized room so callers can update local state immediately
  // without waiting for the onValue snapshot to round-trip.
  return {
    ...room,
    playbackState: 'PAUSED',
    anchorTime: P,
    updatedAt: frozen.updatedAt,
    isPlaying: false,
    currentTime: P,
    hostSessionId: null
  };
};

const WatchPartyApp = () => {
  // All state
  const [view, setView] = useState('home');
  const [roomId, setRoomId] = useState('');
  const [roomSecret, setRoomSecret] = useState('');
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgInput, setMsgInput] = useState('');
  const [ytUrl, setYtUrl] = useState('');
  const [participants, setParticipants] = useState([]);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [videoId, setVideoId] = useState(null);
  const [myAvatar, setMyAvatar] = useState({ emoji: '😊', color: '#ec4899' });
  const [isFs, setIsFs] = useState(false);
  const [floatMsgs, setFloatMsgs] = useState([]);
  const [player, setPlayer] = useState(null);
  const [vidSrc, setVidSrc] = useState('youtube');
  const [driveMountGen, setDriveMountGen] = useState(0);
  const [lastHostRoom, setLastHostRoom] = useState(null);
  const [ytReady, setYtReady] = useState(false);
  // Drive: whether iOS needs a tap to unlock playback for this member.
  const [driveTapNeeded, setDriveTapNeeded] = useState(false);

  // All refs
  const containerRef = useRef(null);
  const lastMsgRef = useRef(null);
  // playerRef now holds a MediaAdapter instance (not a raw YT.Player).
  const playerRef = useRef(null);
  const isHost = useRef(false);
  const roomListener = useRef(null);
  const presenceRef = useRef(null);
  const serverTimeOffset = useRef(0);
  const suppressNextStateChange = useRef(false);
  const isNormalizingRef = useRef(false);
  const normalizationTimeoutRef = useRef(null);
  const isLeavingRef = useRef(false);
  // Stores the active fallback-timeout ID so we can cancel it if onStateChange
  // consumes the suppression first, preventing a stale timeout from clearing a
  // newer suppression window (generation-safe via cancel-before-create pattern).
  const suppressTimeoutRef = useRef(null);
  // Always mirrors the latest React room state so closures (onReady timer,
  // member reconciliation interval) never read stale room data.
  const roomRef = useRef(null);
  // Member-only 5-second local reconciliation interval.
  // Zero Firebase operations — local player commands only.
  const memberSyncInt = useRef(null);
  // Phase 5: host-session presence refs.
  // hostSessionRef     — Firebase ref for the currently active host session node.
  // hostSessionIdLocal — string session ID; null before first .info/connected.
  // A new session ID is generated for every .info/connected → true event so
  // that each Firebase connection lifecycle is independently scoped.
  const hostSessionRef = useRef(null);
  const hostSessionIdLocal = useRef(null);
  // Ref to the <video> element used for Drive HTML5 playback.
  const driveVideoRef = useRef(null);
  // Phase 6C: Drive host seek timeline state.
  // seekGenerationRef — monotonically increasing counter; each seek start
  // increments it. Commit's finally and Firebase write only execute if
  // generation matches. Prevents stale seeks from clobbering newer seeks.
  const seekGenerationRef = useRef(0);
  // Whether room was PLAYING when the current drag started.
  const wasPlayingBeforeSeekRef = useRef(false);

  // Keep roomRef synchronized with the latest room state on every render.
  // This breaks stale closures in onReady callbacks and the reconciliation timer.
  roomRef.current = room;

  // INTEGRATE WEBRTC HOOK (Phase 5 — FROZEN, DO NOT MODIFY)
  const webRTC = useWebRTC(db, roomId, username, isHost.current, room);
  const { isSharing, amSharing, shareHost, startShare, stopShare, changeQuality, currentQuality, vidRef } = webRTC;

  // Drive auth and video hooks (Phase 6 Blob fallback)
  const driveAuth = useDriveAuth();
  const { accessToken, isAuthorized, authError, authorize: authorizeGDrive, clearToken: clearDriveToken } = driveAuth;

  const handleDriveUnauthorized = useCallback(() => {
    // Called by useDriveVideo / useDriveStream on 401 — clear token so UI prompts re-auth.
    clearDriveToken();
  }, [clearDriveToken]);

  const driveVideo = useDriveVideo(handleDriveUnauthorized);
  const {
    blobUrl: driveBlobUrl,
    metadata: driveBlobMetadata,
    loading: driveBlobLoading,
    progress: driveProgress,
    error: driveBlobError,
    loadDriveVideo,
    revokeBlobUrl: revokeDriveBlobUrl,
  } = driveVideo;

  // Drive streaming hook (Phase 7.2 Range streaming)
  const driveStream = useDriveStream({
    proxyUrl: import.meta.env.VITE_MEDIA_PROXY_URL,
    onUnauthorized: handleDriveUnauthorized,
  });
  const {
    mediaUrl: driveStreamUrl,
    metadata: driveStreamMetadata,
    loading: driveStreamLoading,
    error: driveStreamError,
    loadDriveStream,
    revokeStream: revokeDriveStream,
  } = driveStream;

  // Centralized active Drive media resource and states
  const activeDriveUrl = IS_DRIVE_STREAMING ? driveStreamUrl : driveBlobUrl;
  const driveLoading = IS_DRIVE_STREAMING ? driveStreamLoading : driveBlobLoading;
  const driveError = IS_DRIVE_STREAMING ? driveStreamError : driveBlobError;
  const driveMetadata = IS_DRIVE_STREAMING ? driveStreamMetadata : driveBlobMetadata;

  // Options
  const avOpts = [
    { emoji: '😊', color: '#ec4899' }, { emoji: '😎', color: '#8b5cf6' },
    { emoji: '🙂', color: '#3b82f6' }, { emoji: '😄', color: '#f59e0b' },
    { emoji: '😍', color: '#ef4444' }, { emoji: '😉', color: '#10b981' }
  ];
  
  const genId = () => Math.random().toString(36).substring(2, 8).toUpperCase();
  const getYt = (u) => { const r = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/; const m = u.match(r); return (m && m[2].length === 11) ? m[2] : null; };
  const getDrive = (u) => { const ps = [/\/file\/d\/([^/]+)/, /id=([^&]+)/, /\/d\/([^/]+)/]; for (const p of ps) { const m = u.match(p); if (m) return m[1]; } return null; };

  // Load last hosted room from localStorage on mount
  useEffect(() => {
    const savedRoom = localStorage.getItem('lastHostedRoom');
    if (savedRoom) {
      try {
        const roomData = JSON.parse(savedRoom);
        setLastHostRoom(roomData);
      } catch (e) {}
    }
  }, []);

  // Parse room and secret from URL query params on initial load
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlRoom = params.get('room');
      const urlSecret = params.get('s');
      if (urlRoom) {
        setRoomId(urlRoom.trim().toUpperCase());
      }
      if (urlSecret) {
        setRoomSecret(urlSecret.trim());
      }
    } catch (_) {}
  }, []);

  // Track Firebase server-time offset for reference-clock calculations
  useEffect(() => {
    const offsetRef = ref(db, '.info/serverTimeOffset');
    const unsubscribe = onValue(offsetRef, (snap) => {
      serverTimeOffset.current = snap.val() || 0;
    });
    return () => unsubscribe();
  }, []);

  // Setup presence system
  useEffect(() => {
    if (room && username) {
      const myPresenceRef = ref(db, `/rooms/${room.id}/participants/${username}`);
      presenceRef.current = myPresenceRef;
      
      // Set up disconnect handler
      const disconnectRef = onDisconnect(myPresenceRef);
      disconnectRef.remove();
      
      // Keep presence alive
      set(myPresenceRef, true);
    }
    
    return () => {
      if (presenceRef.current) {
        remove(presenceRef.current);
      }
    };
  }, [room?.id, username, db]);

  // Phase 5: host-session presence lifecycle.
  // Runs only for the host. Subscribes to /.info/connected and creates a unique
  // session node for every Firebase connection event so that each onDisconnect
  // is scoped to its own node — preventing old-connection races.
  useEffect(() => {
    if (!room?.id || !username || !isHost.current) return;

    const connectedRef = ref(db, '.info/connected');
    let connectedUnsub = null;

    connectedUnsub = onValue(connectedRef, async (snap) => {
      if (snap.val() !== true || isLeavingRef.current) return; // disconnected/leaving state — nothing to do

      const isFirstConnection = hostSessionRef.current === null;
      let reconnectGuardActive = !isFirstConnection;
      let keepNormalizationGuard = false;
      const clearNormalizationWindow = () => {
        if (normalizationTimeoutRef.current) {
          clearTimeout(normalizationTimeoutRef.current);
          normalizationTimeoutRef.current = null;
        }
        isNormalizingRef.current = false;
      };
      const scheduleNormalizationRelease = () => {
        if (normalizationTimeoutRef.current) clearTimeout(normalizationTimeoutRef.current);
        normalizationTimeoutRef.current = setTimeout(() => {
          normalizationTimeoutRef.current = null;
          isNormalizingRef.current = false;
        }, 1000);
      };
      if (reconnectGuardActive) isNormalizingRef.current = true;

      try {
        if (!isFirstConnection) {
          // RECONNECTION: check whether the previously active host session has
          // gone offline (i.e. its onDisconnect already executed) and the room
          // is still showing PLAYING. If so, normalize to PAUSED at P* before
          // re-establishing the new session.
          const freshSnap = await fbGet(ref(db, '/rooms/' + room.id));
          const freshRoom = freshSnap.val();
          if (!freshRoom) throw new Error('Fresh room snapshot was empty during host reconnect.');

          const interruptedRoom = getHostInterruptedFrozenRoom(freshRoom);
          if (!interruptedRoom) {
            // The previous session is still online (or no interruption can be
            // proven), so ordinary playback may continue without the guard.
            reconnectGuardActive = false;
            isNormalizingRef.current = false;
          } else {
            const normalizedRoom = await normalizeRoomIfInterrupted(room.id, freshRoom);
            if (isLeavingRef.current) return;
            // Make the exact frozen P* authoritative locally before the new
            // session is registered, so onReady/onStateChange cannot use a
            // stale PLAYING room during the transition.
            roomRef.current = normalizedRoom;
            setRoom(normalizedRoom);
            if (playerRef.current) {
              try {
                syncMemberPlayerRefClock(playerRef.current, normalizedRoom, serverTimeOffset.current);
                playerRef.current.seek(normalizedRoom.anchorTime);
                playerRef.current.pause();
              } catch (err) {
                console.error('[Phase 5] Failed to normalize the returning host player.', err);
                return;
              }
            }
          }
        }

        if (isLeavingRef.current) {
          return;
        }

        // Generate a fresh session ID for THIS connection event.
        // Never reuse the previous session ID — each .info/connected event
        // is a distinct Firebase connection context.
        const newSessionId = push(ref(db, '/rooms/' + room.id + '/hostPresence')).key;
        const newSessionNodeRef = ref(db, '/rooms/' + room.id + '/hostPresence/' + newSessionId);
        const clearLocalSession = () => {
          if (hostSessionRef.current === newSessionNodeRef) hostSessionRef.current = null;
          if (hostSessionIdLocal.current === newSessionId) hostSessionIdLocal.current = null;
        };
        const discardSession = async () => {
          try {
            await onDisconnect(newSessionNodeRef).cancel();
          } catch (err) {
            console.error('[Phase 5] Failed to cancel an uncommitted host session.', err);
          }
          try {
            await update(newSessionNodeRef, { online: false, endedAt: serverTimestamp() });
          } catch (err) {
            console.error('[Phase 5] Failed to close an uncommitted host session.', err);
          }
        };

        // Publish the pending node ref early so leave() can close it if it
        // overlaps this async reconnect transition.
        hostSessionRef.current = newSessionNodeRef;
        hostSessionIdLocal.current = newSessionId;

        // ARM onDisconnect BEFORE writing online:true so there is no window
        // where the session is online but the server has no disconnect handler.
        try {
          await onDisconnect(newSessionNodeRef).update({
            online: false,
            endedAt: serverTimestamp()
          });
        } catch (err) {
          console.error('[Phase 5] Failed to arm the returning host session.', err);
          clearLocalSession();
          return;
        }

        // Write the online marker AFTER onDisconnect is armed.
        try {
          await set(newSessionNodeRef, {
            user: username,
            online: true,
            startedAt: serverTimestamp(),
            endedAt: null
          });
        } catch (err) {
          console.error('[Phase 5] Failed to write the returning host session.', err);
          await discardSession();
          clearLocalSession();
          return;
        }

        if (isLeavingRef.current) {
          await discardSession();
          clearLocalSession();
          return;
        }

        // Update room root to point to the active session. Do not treat the
        // host as active if this authoritative pointer write fails.
        try {
          await update(ref(db, '/rooms/' + room.id), { hostSessionId: newSessionId });
        } catch (err) {
          console.error('[Phase 5] Failed to publish the returning hostSessionId; host session aborted.', err);
          await discardSession();
          clearLocalSession();
          return;
        }

        if (isLeavingRef.current) {
          await discardSession();
          clearLocalSession();
          return;
        }

        if (reconnectGuardActive) {
          scheduleNormalizationRelease();
          keepNormalizationGuard = true;
        }
      } catch (err) {
        console.error('[Phase 5] Host reconnect failed; no new host session was registered.', err);
      } finally {
        if (!keepNormalizationGuard) clearNormalizationWindow();
      }
    });

    return () => {
      if (connectedUnsub) connectedUnsub();
      // Note: do NOT cancel the old onDisconnect here.
      // The cleanup of the session node happens either via:
      //   a) leave()   — graceful explicit write + cancel
      //   b) server    — onDisconnect fires on connection loss
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, username, db]);

  // YouTube API setup
  useEffect(() => {
    // If the API is already fully initialised (e.g. hot-reload / re-mount)
    if (window.YT && window.YT.Player) {
      setYtReady(true);
      return;
    }
    // Wire the ready callback BEFORE injecting the script so we never miss it
    window.onYouTubeIframeAPIReady = () => setYtReady(true);
    // Guard against duplicate injection (e.g. StrictMode double-mount)
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const t = document.createElement('script');
      t.src = 'https://www.youtube.com/iframe_api';
      const f = document.getElementsByTagName('script')[0];
      f.parentNode.insertBefore(t, f);
    }
  }, []);

  // Real-time listener
  useEffect(() => {
    if (view === 'room' && room) {
      const roomRef_ = ref(db, '/rooms/' + room.id);
      const unsubscribe = onValue(roomRef_, (snapshot) => {
        const rm = snapshot.val();
        if (rm) {
          setRoom(rm);
          const participantsList = Object.keys(rm.participants || {});
          setParticipants(participantsList);
          const rawMsgs = rm.messages || {};
          const msgArray = Array.isArray(rawMsgs)
            ? rawMsgs
            : Object.values(rawMsgs).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          setMessages(msgArray);
          if (rm.videoId && rm.videoId !== videoId) {
            setVideoId(rm.videoId);
            setVidSrc(rm.videoSource || 'youtube');
          }
          // Sync member player for BOTH youtube and drive sources.
          if (!isHost.current && playerRef.current) {
            // Phase 5: substitute frozen PAUSED room when host is disconnected
            // mid-PLAYING, so the sync function naturally pauses at P*.
            const effectiveRoom = getHostInterruptedFrozenRoom(rm) || rm;
            syncMemberPlayerRefClock(playerRef.current, effectiveRoom, serverTimeOffset.current);
          }
        }
      });
      roomListener.current = unsubscribe;
      return () => {
        unsubscribe();
      };
    }
  }, [view, room?.id, videoId, vidSrc]);

  // visibilitychange recovery: re-sync the active adapter when the tab/app
  // returns to the foreground. Particularly important for iOS Safari where
  // background tabs can have timers throttled and video paused by the OS.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) return;
      if (!playerRef.current || !roomRef.current) return;
      // Hosts are authoritative — they do not follow the room clock.
      if (isHost.current) return;
      // Apply the same interrupted-host / frozen-room substitution used by
      // the onValue listener and the member reconciliation interval.
      // This prevents a returning member from advancing past the frozen P*
      // after a host disappearance.
      const effectiveRoom = getHostInterruptedFrozenRoom(roomRef.current) || roomRef.current;
      syncMemberPlayerRefClock(playerRef.current, effectiveRoom, serverTimeOffset.current);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // YouTube adapter setup
  useEffect(() => {
    if (videoId && ytReady && window.YT && window.YT.Player && vidSrc === 'youtube') {
      // Destroy previous adapter (YouTube or Drive) before creating a new one.
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      setDriveTapNeeded(false);
      const c = document.getElementById('yt-player');
      if (!c) return;

      const adapter = createYouTubeAdapter('yt-player', videoId);

      adapter.onReady(() => {
        playerRef.current = adapter;
        setPlayer(adapter);
        setTimeout(() => {
          if (isHost.current) {
            // A returning host must never sync from a stale PLAYING room.
            const hostRoom = roomRef.current;
            const effectiveHostRoom = getHostInterruptedFrozenRoom(hostRoom) || hostRoom;
            if (effectiveHostRoom && (!isNormalizingRef.current || effectiveHostRoom.playbackState !== 'PLAYING')) {
              syncMemberPlayerRefClock(adapter, effectiveHostRoom, serverTimeOffset.current);
            }
          } else if (roomRef.current) {
            // Initial member sync using ref (avoids stale closure).
            const effectiveRoomOnReady = getHostInterruptedFrozenRoom(roomRef.current) || roomRef.current;
            syncMemberPlayerRefClock(adapter, effectiveRoomOnReady, serverTimeOffset.current);
            // Start local-only reconciliation timer.
            if (memberSyncInt.current) clearInterval(memberSyncInt.current);
            memberSyncInt.current = setInterval(() => {
              if (playerRef.current && roomRef.current && !isHost.current) {
                const effectiveRoomInterval = getHostInterruptedFrozenRoom(roomRef.current) || roomRef.current;
                syncMemberPlayerRefClock(playerRef.current, effectiveRoomInterval, serverTimeOffset.current);
              }
            }, 5000);
          }
        }, 500);
      });

      adapter.onStateChange(async (stateName) => {
        if (!isHost.current) return;
        // Ignore every YouTube event caused by reconnect normalization.
        if (isNormalizingRef.current) return;
        // Suppress the duplicate event that follows a togglePlay write.
        if (suppressNextStateChange.current) {
          suppressNextStateChange.current = false;
          if (suppressTimeoutRef.current) {
            clearTimeout(suppressTimeoutRef.current);
            suppressTimeoutRef.current = null;
          }
          return;
        }
        const activeRoom = roomRef.current;
        if (activeRoom) {
          try {
            const t = adapter.getCurrentTime();
            // ENDED → represent as PAUSED at the final position.
            // PLAYING → new anchor at current position.
            // PAUSED  → anchor at current position.
            const isPlaying = stateName === 'PLAYING';
            const playbackState = isPlaying ? 'PLAYING' : 'PAUSED';
            await update(ref(db, '/rooms/' + activeRoom.id), {
              // Reference-clock fields
              playbackState,
              anchorTime: t,
              updatedAt: serverTimestamp(),
              // Legacy fields — kept for member compat
              isPlaying,
              currentTime: t
            });
          } catch (err) {}
        }
      });

      adapter.onError((e) => {
        console.error('[YouTube] Player error:', e);
      });
    }
    return () => {
      if (memberSyncInt.current) {
        clearInterval(memberSyncInt.current);
        memberSyncInt.current = null;
      }
      if (playerRef.current && vidSrc === 'youtube') {
        try { playerRef.current.destroy(); } catch (e) {}
        playerRef.current = null;
      }
    };
  }, [videoId, vidSrc, ytReady]);

  // Drive HTML5 adapter setup — runs when the Drive media URL becomes available.
  useEffect(() => {
    if (vidSrc !== 'drive' || !activeDriveUrl || !driveVideoRef.current) return;

    // Destroy any existing adapter (e.g. a previous Drive load).
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }
    setDriveTapNeeded(false);

    const videoEl = driveVideoRef.current;
    const adapter = createHTML5Adapter(videoEl, activeDriveUrl);

    adapter.onReady(() => {
      playerRef.current = adapter;
      setPlayer(adapter);

      if (isHost.current) {
        // Host: sync from effective room state (same pattern as YouTube).
        const hostRoom = roomRef.current;
        const effectiveHostRoom = getHostInterruptedFrozenRoom(hostRoom) || hostRoom;
        if (effectiveHostRoom && (!isNormalizingRef.current || effectiveHostRoom.playbackState !== 'PLAYING')) {
          syncMemberPlayerRefClock(adapter, effectiveHostRoom, serverTimeOffset.current);
        }
      } else if (roomRef.current) {
        // Member: attempt immediate sync; iOS may block the play() call.
        const effectiveRoom = getHostInterruptedFrozenRoom(roomRef.current) || roomRef.current;
        syncMemberPlayerRefClock(adapter, effectiveRoom, serverTimeOffset.current);
        // Start reconciliation interval.
        if (memberSyncInt.current) clearInterval(memberSyncInt.current);
        memberSyncInt.current = setInterval(() => {
          if (playerRef.current && roomRef.current && !isHost.current) {
            const effectiveRoomInterval = getHostInterruptedFrozenRoom(roomRef.current) || roomRef.current;
            syncMemberPlayerRefClock(playerRef.current, effectiveRoomInterval, serverTimeOffset.current);
          }
        }, 5000);
      }
    });

    adapter.onStateChange(async (stateName) => {
      if (!isHost.current) return;
      if (isNormalizingRef.current) return;
      if (suppressNextStateChange.current) {
        // M-02: NEVER suppress ENDED — terminal state must always reach
        // Firebase to prevent the reference clock from remaining PLAYING
        // after the media has finished.
        if (stateName !== 'ENDED') {
          suppressNextStateChange.current = false;
          if (suppressTimeoutRef.current) {
            clearTimeout(suppressTimeoutRef.current);
            suppressTimeoutRef.current = null;
          }
          return;
        }
        // ENDED: clear suppression and fall through to write Firebase.
        suppressNextStateChange.current = false;
        if (suppressTimeoutRef.current) {
          clearTimeout(suppressTimeoutRef.current);
          suppressTimeoutRef.current = null;
        }
      }
      const activeRoom = roomRef.current;
      if (activeRoom) {
        try {
          const t = adapter.getCurrentTime();
          const isPlaying = stateName === 'PLAYING';
          const playbackState = isPlaying ? 'PLAYING' : 'PAUSED';
          await update(ref(db, '/rooms/' + activeRoom.id), {
            playbackState,
            anchorTime: t,
            updatedAt: serverTimestamp(),
            isPlaying,
            currentTime: t
          });
        } catch (err) {}
      }
    });

    adapter.onError((mediaError) => {
      console.error('[Drive HTML5] Video error:', mediaError);
    });

    return () => {
      if (memberSyncInt.current) {
        clearInterval(memberSyncInt.current);
        memberSyncInt.current = null;
      }
      // Do NOT destroy the adapter here — the adapter lifecycle is managed by
      // videoId/vidSrc changes and leave(). Destroying on blobUrl change
      // would remove listeners before the component unmounts.
    };
  }, [vidSrc, activeDriveUrl, driveMountGen]);

  // When streaming feature flag is ON: fetch playback ticket when videoId or room auth changes.
  useEffect(() => {
    if (!IS_DRIVE_STREAMING) return;
    if (vidSrc === 'drive' && videoId) {
      const activeSecret = roomSecret || (isHost.current ? (room?.secret || '') : '');
      if (room?.id && activeSecret && username) {
        loadDriveStream(videoId, {
          roomId: room.id,
          roomSecret: activeSecret,
          username,
        });
      }
    }
  }, [vidSrc, videoId, room?.id, roomSecret, username, loadDriveStream]);

  // When streaming feature flag is OFF: trigger Blob download when videoId or accessToken changes.
  useEffect(() => {
    if (IS_DRIVE_STREAMING) return;
    if (vidSrc === 'drive' && videoId && accessToken) {
      loadDriveVideo(videoId, accessToken);
    }
  }, [vidSrc, videoId, accessToken, loadDriveVideo]);

  // Fix 3: Drive → non-Drive cleanup.
  // When vidSrc transitions away from 'drive' (e.g. host switches to YouTube),
  // cancel any active stream/download and revoke resources so no stale state remains.
  const prevVidSrcRef = useRef(vidSrc);
  useEffect(() => {
    const prev = prevVidSrcRef.current;
    prevVidSrcRef.current = vidSrc;
    if (prev === 'drive' && vidSrc !== 'drive') {
      if (IS_DRIVE_STREAMING) {
        revokeDriveStream();
      } else {
        revokeDriveBlobUrl();
      }
    }
  }, [vidSrc, revokeDriveStream, revokeDriveBlobUrl]);

  // Floating messages
  useEffect(() => {
    if (messages.length > 0 && isFs) {
      const last = messages[messages.length - 1];
      if (last.type === 'user' && last.timestamp !== lastMsgRef.current) {
        lastMsgRef.current = last.timestamp;
        setFloatMsgs(p => [...p.slice(-4), { id: last.timestamp, user: last.user, text: last.text }]);
        setTimeout(() => setFloatMsgs(p => p.filter(m => m.id !== last.timestamp)), 4000);
      }
    }
  }, [messages, isFs]);

  // Fullscreen listener
  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  // Room functions
  const create = async () => {
    if (!username.trim()) return alert('Enter name');
    setLoading(true);
    const id = genId();
    const secret = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (genId() + genId() + genId() + genId());
    const roomRef_ = ref(db, '/rooms/' + id);
    const rm = { 
      id, 
      secret,
      roomSecret: secret,
      host: username, 
      participants: { [username]: true }, 
      createdAt: Date.now(), 
      videoId: null, 
      videoSource: 'youtube', 
      isPlaying: false, 
      currentTime: 0, 
      roomName: username + "'s Room",
      isSharing: false,
      shareHost: null,
      // Reference-clock fields (Phase 1: initialized, not yet consumed)
      playbackState: 'PAUSED',
      anchorTime: 0,
      updatedAt: 0
    };
    try {
      await set(roomRef_, rm);
      
      localStorage.setItem('lastHostedRoom', JSON.stringify({
        roomId: id,
        hostName: username,
        roomSecret: secret,
        createdAt: Date.now()
      }));
      
      isLeavingRef.current = false;
      isHost.current = true;
      setRoom(rm);
      setRoomSecret(secret);
      setParticipants([username]);
      setRoomId(id);
      setView('room');
    } catch (e) { alert('Failed to create room'); }
    setLoading(false);
  };

  const rejoinAsHost = async () => {
    if (!lastHostRoom || !username.trim()) return alert('Enter your name');
    setLoading(true);
    const id = lastHostRoom.roomId;
    const roomRef_ = ref(db, '/rooms/' + id);
    
    try {
      const snapshot = await fbGet(roomRef_);
      let rm = snapshot.val();
      
      if (rm && rm.host === lastHostRoom.hostName) {
        // Phase 5: before becoming authoritative, normalize any stale PLAYING
        // clock caused by a previous host-disappearance. This prevents the
        // rejoining host from inheriting an advancing ghost clock.
        rm = await normalizeRoomIfInterrupted(id, rm);

        await update(ref(db, '/rooms/' + id + '/participants'), { [username]: true });
        
        await push(ref(db, '/rooms/' + id + '/messages'), 
          { type: 'system', text: username + ' (Host) rejoined', time: new Date().toLocaleTimeString(), timestamp: Date.now() }
        );
        
        const activeSecret = lastHostRoom.roomSecret || rm.secret || '';
        if (activeSecret) setRoomSecret(activeSecret);

        isLeavingRef.current = false;
        isHost.current = true;
        setRoom(rm);
        setRoomId(id);
        setView('room');
        if (rm.videoId) { setVideoId(rm.videoId); setVidSrc(rm.videoSource || 'youtube'); }
      } else {
        alert('Room not found or you are not the host');
        localStorage.removeItem('lastHostedRoom');
        setLastHostRoom(null);
      }
    } catch (e) { 
      alert('Failed to rejoin room'); 
    }
    setLoading(false);
  };

  const join = async () => {
    if (!username.trim() || !roomId.trim()) return alert('Enter name and ID');
    setLoading(true);
    let id = roomId.trim();
    let secretCandidate = roomSecret;
    // Extract room and secret if user pasted a full URL or query string
    if (id.includes('?') || id.startsWith('http')) {
      try {
        const parsed = new URL(id.startsWith('http') ? id : `https://dummy/${id}`);
        const qRoom = parsed.searchParams.get('room');
        const qSecret = parsed.searchParams.get('s');
        if (qRoom) id = qRoom;
        if (qSecret) {
          secretCandidate = qSecret;
          setRoomSecret(qSecret);
        }
      } catch (_) {}
    }
    id = id.toUpperCase();
    const roomRef_ = ref(db, '/rooms/' + id);
    try {
      const snapshot = await fbGet(roomRef_);
      const rm = snapshot.val();
      if (rm) {
        const finalSecret = secretCandidate || '';
        setRoomSecret(finalSecret);
        await update(ref(db, '/rooms/' + id + '/participants'), { [username]: true });
        
        await push(ref(db, '/rooms/' + id + '/messages'), 
          { type: 'system', text: username + ' joined', time: new Date().toLocaleTimeString(), timestamp: Date.now() }
        );
        
        setRoom(rm);
        setRoomId(id);
        setView('room');
        isHost.current = false;
        if (rm.videoId) { setVideoId(rm.videoId); setVidSrc(rm.videoSource || 'youtube'); }
      } else { alert('Room not found'); }
    } catch (e) { alert('Failed to join room'); }
    setLoading(false);
  };
  
  // Legacy member sync (pre-Phase-2 rooms without reference-clock fields).
  // Uses adapter methods instead of direct YT API.
  const syncMemberPlayer = (adapter, currentRoom) => {
    if (!adapter || !currentRoom) return;
    try {
      const st = adapter.getState();
      if (st === 'UNSTARTED' || st === 'CUED') return;
      const ct = adapter.getCurrentTime();
      const tt = currentRoom.currentTime || 0;
      const diff = Math.abs(ct - tt);
      if (diff > 1) {
        adapter.seek(tt);
      }
      const shouldPlay = currentRoom.isPlaying;
      const isPlaying = st === 'PLAYING';
      const isBuffering = st === 'BUFFERING';
      if (shouldPlay && !isPlaying && !isBuffering) {
        const p = adapter.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => setDriveTapNeeded(true));
        }
      } else if (!shouldPlay && isPlaying) {
        adapter.pause();
      }
    } catch (e) {}
  };

  /**
   * Member synchronization using the reference clock.
   * Falls back to the legacy syncMemberPlayer when reference-clock data is
   * missing (pre-Phase-2 rooms) or not yet populated.
   *
   * For Drive HTML5 video on iOS:
   *   - Attempt play() normally.
   *   - If Safari rejects the call (Promise rejects), expose Tap-to-Sync UX.
   *
   * Buffering rules:
   *   PLAYING + buffering  → do not fight buffer; player will resume naturally.
   *   PAUSED  + buffering  → force pause; prevents auto-playing after buffer.
   */
  const syncMemberPlayerRefClock = (adapter, currentRoom, offset) => {
    if (!adapter || !currentRoom) return;
    try {
      const st = adapter.getState();
      // UNSTARTED: adapter not initialised — cannot issue any commands.
      if (st === 'UNSTARTED') return;

      const expected = getExpectedPosition(currentRoom, offset);

      // Reference clock not valid → use legacy sync as migration fallback
      if (expected === null) {
        syncMemberPlayer(adapter, currentRoom);
        return;
      }

      const shouldPlay = currentRoom.playbackState === 'PLAYING';
      const ct = adapter.getCurrentTime();
      const drift = Math.abs(ct - expected);

      const isPlaying = st === 'PLAYING';
      const isBuffering = st === 'BUFFERING';

      // Hard seek when drift exceeds 2-second threshold.
      // Deferred (not skipped) while BUFFERING: seeking a stalled player
      // discards its buffer and restarts the stall, creating a
      // seek → refetch → buffer → seek loop under network streaming.
      // The next reconciliation tick (≤5s) re-evaluates once BUFFERING clears.
      if (drift >= 2 && !isBuffering) {
        adapter.seek(expected);
      }

      // PLAYING room + buffering → let the player resolve buffer naturally.
      if (shouldPlay && !isPlaying && !isBuffering) {
        const p = adapter.play();
        // HTML5Adapter.play() returns a Promise. YouTube adapter returns void.
        // On iOS, if play() is rejected (autoplay policy), show Tap-to-Sync.
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            setDriveTapNeeded(true);
          });
        }
      } else if (!shouldPlay && (isPlaying || isBuffering || st === 'CUED')) {
        adapter.pause();
      }
    } catch (e) {}
  };

  const copy = () => { 
    if (navigator.clipboard) {
      const shareSecret = roomSecret || (isHost.current ? room?.secret : '');
      const shareUrl = shareSecret 
        ? `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(room.id)}&s=${encodeURIComponent(shareSecret)}`
        : `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(room.id)}`;
      navigator.clipboard.writeText(shareUrl); 
      setCopied(true); 
      setTimeout(() => setCopied(false), 2000); 
    } else {
      alert('Clipboard access is not available. Please use https://');
    }
  };
  
  const sendMsg = async () => {
    if (msgInput.trim() && room) {
      try {
        const newMsg = { 
          type: 'user', 
          user: username, 
          text: msgInput.trim(), 
          time: new Date().toLocaleTimeString(), 
          timestamp: Date.now() 
        };
        await push(ref(db, '/rooms/' + room.id + '/messages'), newMsg);
        setMsgInput('');
      } catch (e) {}
    }
  };

  // ---------------------------------------------------------------------------
  // Phase 6C: Drive Host Seek Handlers
  // ---------------------------------------------------------------------------

  /**
   * Called when the host begins dragging the timeline slider.
   * Increments the seek generation to invalidate any older pending seek.
   * Wrapped in useCallback so DriveTimeline's React.memo is effective (S-03).
   */
  const handleDriveSeekStart = useCallback((time) => {
    ++seekGenerationRef.current;
    const currentRoom = roomRef.current;
    wasPlayingBeforeSeekRef.current = currentRoom?.playbackState === 'PLAYING';
  }, []);

  /**
   * Called when the host releases the timeline slider.
   * Follows the exact Phase 6B togglePlay pattern for play() await/catch.
   * Uses seekGenerationRef for ownership — only the latest seek may
   * write Firebase or clean up shared state.
   *
   * M-02: seek-to-end explicitly pauses and publishes PAUSED at duration.
   * S-04: anchorTime is clamped to exact duration for seek-to-end.
   * S-05: suppression armed before adapter commands, safely cleared on all paths.
   */
  const handleDriveSeekCommit = useCallback(async (time) => {
    const myGeneration = seekGenerationRef.current;

    // --- Input validation ---
    const adapter = playerRef.current;
    if (!adapter) {
      if (seekGenerationRef.current === myGeneration) {
        wasPlayingBeforeSeekRef.current = false;
      }
      return;
    }
    const duration = adapter.getDuration();
    if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) {
      if (seekGenerationRef.current === myGeneration) {
        wasPlayingBeforeSeekRef.current = false;
      }
      return;
    }
    let finalPos = Math.max(0, Math.min(time, duration));

    // --- Snapshot identity for staleness detection ---
    const snapshotVidSrc = vidSrc;
    const snapshotVideoId = videoId;
    const snapshotAdapter = adapter;

    // --- Seek-to-end detection (S-04) ---
    const isAtEnd = finalPos >= duration - 0.5;
    if (isAtEnd) {
      finalPos = duration; // Clamp to exact terminal position.
    }

    try {
      // Pre-commit guards
      if (!playerRef.current || !roomRef.current || !isHost.current) return;
      if (isLeavingRef.current || isNormalizingRef.current) return;

      const wasPlaying = wasPlayingBeforeSeekRef.current && !isAtEnd;

      // Seek the video element to the final position (exactly once).
      adapter.seek(finalPos);

      // Determine resolved playback state.
      let resolvedPlaying = false;

      if (isAtEnd && wasPlayingBeforeSeekRef.current) {
        // S-04: Video was playing but we're seeking to the end.
        // Explicitly pause to prevent the video from reaching 'ended'
        // while Firebase shows PLAYING. Arm suppression BEFORE the
        // pause command to absorb the expected PAUSED event (S-05).
        if (suppressTimeoutRef.current) clearTimeout(suppressTimeoutRef.current);
        suppressNextStateChange.current = true;
        suppressTimeoutRef.current = setTimeout(() => {
          suppressNextStateChange.current = false;
          suppressTimeoutRef.current = null;
        }, 1000);
        adapter.pause();
        // resolvedPlaying remains false — publish PAUSED at duration.
      } else if (wasPlaying) {
        // ARM SUPPRESSION — exact Phase 6B pattern (S-05: before play).
        if (suppressTimeoutRef.current) clearTimeout(suppressTimeoutRef.current);
        suppressNextStateChange.current = true;
        suppressTimeoutRef.current = setTimeout(() => {
          suppressNextStateChange.current = false;
          suppressTimeoutRef.current = null;
        }, 1000);

        setDriveTapNeeded(false);
        try {
          const p = adapter.play();
          if (p && typeof p.then === 'function') {
            await p;
          }
          // play() succeeded.
          resolvedPlaying = true;
        } catch {
          // play() rejected — iOS autoplay or element error.
          suppressNextStateChange.current = false;
          if (suppressTimeoutRef.current) {
            clearTimeout(suppressTimeoutRef.current);
            suppressTimeoutRef.current = null;
          }
          setDriveTapNeeded(true);
          resolvedPlaying = false;
        }
      }
      // If was paused (and not isAtEnd): video remains paused at finalPos.

      // --- Generation + staleness check before Firebase write ---
      if (seekGenerationRef.current !== myGeneration) return;
      if (vidSrc !== snapshotVidSrc) return;
      if (videoId !== snapshotVideoId) return;
      if (playerRef.current !== snapshotAdapter) return;
      if (isLeavingRef.current) return;
      if (!roomRef.current) return;

      // --- Firebase write (exactly once) ---
      await update(ref(db, '/rooms/' + roomRef.current.id), {
        playbackState: resolvedPlaying ? 'PLAYING' : 'PAUSED',
        anchorTime: finalPos,
        updatedAt: serverTimestamp(),
        isPlaying: resolvedPlaying,
        currentTime: finalPos
      });
    } catch (err) {
      // Adapter, Firebase, or other failure — clear suppression.
      if (suppressTimeoutRef.current) clearTimeout(suppressTimeoutRef.current);
      suppressTimeoutRef.current = null;
      suppressNextStateChange.current = false;
    } finally {
      // Only clean up state if this seek is STILL the current owner.
      if (seekGenerationRef.current === myGeneration) {
        wasPlayingBeforeSeekRef.current = false;
      }
    }
  }, [vidSrc, videoId]);

  const load = async () => {
    if (isNormalizingRef.current) return;
    // Phase 6C: cancel any in-progress seek by advancing generation.
    ++seekGenerationRef.current;
    wasPlayingBeforeSeekRef.current = false;
    let vid = null;
    let src = 'youtube';
    if (ytUrl.includes('youtube.com') || ytUrl.includes('youtu.be')) { 
      vid = getYt(ytUrl); 
      src = 'youtube'; 
    } else if (ytUrl.includes('drive.google.com')) { 
      vid = getDrive(ytUrl); 
      src = 'drive'; 
    }
    
    if (vid && room) {
      // If switching to Drive in fallback mode and not yet authorized, prompt auth first.
      if (src === 'drive' && !IS_DRIVE_STREAMING && !isAuthorized) {
        try {
          await authorizeGDrive();
        } catch (err) {
          alert('Google Drive authorization failed. Please try again.');
          return;
        }
      }

      const isSameDrive = src === 'drive' && vidSrc === 'drive' && vid === videoId && activeDriveUrl;
      if (isSameDrive) {
        // Recreate the adapter while retaining the active media resource.
        if (playerRef.current) {
          playerRef.current.destroy({ revokeObjectUrl: false });
          playerRef.current = null;
          setPlayer(null);
        }
        setDriveMountGen((generation) => generation + 1);
      } else {
        // Destroy existing adapter and revoke any Drive blob or stream before switching.
        if (playerRef.current) {
          playerRef.current.destroy();
          playerRef.current = null;
        }
        if (vidSrc === 'drive' || src === 'drive') {
          if (IS_DRIVE_STREAMING) {
            revokeDriveStream();
          } else {
            revokeDriveBlobUrl();
          }
        }
      }
      setDriveTapNeeded(false);

      await update(ref(db, '/rooms/' + room.id), {
        videoId: vid,
        videoSource: src,
        // Legacy fields
        isPlaying: false,
        currentTime: 0,
        // Reference-clock fields — new video starts paused at 0
        playbackState: 'PAUSED',
        anchorTime: 0,
        updatedAt: serverTimestamp()
      });
      
      await push(ref(db, '/rooms/' + room.id + '/messages'), { 
        type: 'system', 
        text: username + ' loaded ' + (src === 'youtube' ? 'YouTube' : 'Google Drive') + ' video', 
        time: new Date().toLocaleTimeString(), 
        timestamp: Date.now() 
      });
      
      setVideoId(vid);
      setVidSrc(src);
    } else { 
      alert('Invalid URL'); 
    }
  };

  const togglePlay = async () => {
    if (isNormalizingRef.current) return;
    if (!room || !playerRef.current) return;
    const adapter = playerRef.current;

    // Use reference-clock field — not the legacy isPlaying field — to determine
    // the toggled state. isPlaying is kept for schema compatibility only.
    const playing = room.playbackState !== 'PLAYING';
    let t = 0;
    try {
      t = adapter.getCurrentTime();

      if (vidSrc === 'drive') {
        // For HTML5 Drive on iOS: call adapter.play() FIRST (synchronously
        // from the gesture handler) to preserve the user-gesture context,
        // then write Firebase. We await the play() Promise so we only
        // publish PLAYING when play actually succeeds.
        //
        // Arm suppression before the command so the resulting onStateChange
        // is suppressed.
        if (suppressTimeoutRef.current) clearTimeout(suppressTimeoutRef.current);
        suppressNextStateChange.current = true;
        suppressTimeoutRef.current = setTimeout(() => {
          suppressNextStateChange.current = false;
          suppressTimeoutRef.current = null;
        }, 1000);

        // Resolved state: what we will actually publish to Firebase.
        // Default to PAUSED in case play() is not called or rejects.
        let resolvedPlaying = playing;

        if (playing) {
          setDriveTapNeeded(false); // hide tap overlay — gesture is in progress
          try {
            const p = adapter.play();
            // HTML5Adapter returns a Promise; await it so we know if Safari
            // accepted the play call before we publish PLAYING.
            if (p && typeof p.then === 'function') {
              await p;
              // play() resolved — PLAYING is confirmed.
            }
            // If adapter.play() returned void (non-Promise), treat as success.
          } catch {
            // play() rejected (iOS autoplay policy or element error).
            // Clear suppression so the next genuine state event is not lost.
            suppressNextStateChange.current = false;
            if (suppressTimeoutRef.current) {
              clearTimeout(suppressTimeoutRef.current);
              suppressTimeoutRef.current = null;
            }
            setDriveTapNeeded(true);
            // Do not publish PLAYING — fall back to PAUSED.
            resolvedPlaying = false;
          }
        } else {
          adapter.pause();
        }

        // Firebase write follows asynchronously (gesture context already used).
        await update(ref(db, '/rooms/' + room.id), {
          playbackState: resolvedPlaying ? 'PLAYING' : 'PAUSED',
          anchorTime: t,
          updatedAt: serverTimestamp(),
          isPlaying: resolvedPlaying,
          currentTime: t
        });
      } else {
        // YouTube: write Firebase first, then call the adapter command.
        // This is the original Phase 4 ordering which is correct for YouTube
        // (the YouTube iframe handles gesture context internally).
        await update(ref(db, '/rooms/' + room.id), {
          playbackState: playing ? 'PLAYING' : 'PAUSED',
          anchorTime: t,
          updatedAt: serverTimestamp(),
          isPlaying: playing,
          currentTime: t
        });
        // Arm suppression immediately before calling the player so only the
        // single onStateChange that follows this call is suppressed.
        if (suppressTimeoutRef.current) clearTimeout(suppressTimeoutRef.current);
        suppressNextStateChange.current = true;
        suppressTimeoutRef.current = setTimeout(() => {
          suppressNextStateChange.current = false;
          suppressTimeoutRef.current = null;
        }, 1000);
        if (playing) adapter.play();
        else adapter.pause();
      }
    } catch (e) {
      // Write or player call failed — clear suppression so no future event is lost.
      if (suppressTimeoutRef.current) clearTimeout(suppressTimeoutRef.current);
      suppressTimeoutRef.current = null;
      suppressNextStateChange.current = false;
    }
  };

  /**
   * Tap-to-Sync handler for iOS members.
   *
   * Called from user gesture (tap). Attempts to unlock the video element for
   * programmatic play/pause. After the initial gesture-initiated call, Safari
   * allows subsequent programmatic calls without gesture requirement.
   */
  const onDriveTapToSync = () => {
    setDriveTapNeeded(false);
    if (!playerRef.current || !roomRef.current) return;
    const adapter = playerRef.current;
    const currentRoom = roomRef.current;
    const effectiveRoom = getHostInterruptedFrozenRoom(currentRoom) || currentRoom;
    const expected = getExpectedPosition(effectiveRoom, serverTimeOffset.current);
    if (expected !== null) {
      adapter.seek(expected);
    }
    if (effectiveRoom.playbackState === 'PLAYING') {
      const p = adapter.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // Still blocked — leave the overlay hidden; user will try again.
        });
      }
    } else {
      adapter.pause();
    }
  };

  const toggleFs = () => {
    if (!document.fullscreenElement) { containerRef.current?.requestFullscreen?.(); setIsFs(true); }
    else { document.exitFullscreen?.(); setIsFs(false); }
  };

  const leave = async () => {
    isLeavingRef.current = true;
    // Phase 6C: cancel any in-progress seek by advancing generation.
    ++seekGenerationRef.current;
    wasPlayingBeforeSeekRef.current = false;
    if (normalizationTimeoutRef.current) {
      clearTimeout(normalizationTimeoutRef.current);
      normalizationTimeoutRef.current = null;
    }
    isNormalizingRef.current = false;
    // Phase 5: host graceful leave sequence.
    // Step 1 — write PAUSED before closing so members see the correct final state.
    // Step 2 — mark session offline and clear hostSessionId.
    // These must come before connection teardown so members get the update.
    if (isHost.current && room) {
      try {
        const t = playerRef.current ? (playerRef.current.getCurrentTime() ?? room.anchorTime ?? 0) : (room.anchorTime ?? 0);
        await update(ref(db, '/rooms/' + room.id), {
          // Reference-clock fields
          playbackState: 'PAUSED',
          anchorTime: t,
          updatedAt: serverTimestamp(),
          // Legacy fields
          isPlaying: false,
          currentTime: t,
          // Clear the active host session so members know no host is present
          hostSessionId: null
        });
      } catch (_) {}

      // Mark the session node offline and cancel its queued onDisconnect so it
      // doesn't fire redundantly after the connection closes.
      if (hostSessionRef.current) {
        try {
          await onDisconnect(hostSessionRef.current).cancel();
        } catch (_) {}
        try {
          await update(hostSessionRef.current, { online: false, endedAt: serverTimestamp() });
        } catch (_) {}
        hostSessionRef.current = null;
        hostSessionIdLocal.current = null;
      }
    }

    if (room && username) {
      try {
        const participantRef = ref(db, `/rooms/${room.id}/participants/${username}`);
        await remove(participantRef);
        
        await push(ref(db, '/rooms/' + room.id + '/messages'), { 
          type: 'system', 
          text: username + ' left', 
          time: new Date().toLocaleTimeString(), 
          timestamp: Date.now() 
        });
      } catch (e) {}
    }
    
    // Destroy adapter (revokes Drive ObjectURL if applicable).
    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch (e) {}
      playerRef.current = null;
    }
    // Revoke any pending Drive stream or blob URL
    if (IS_DRIVE_STREAMING) {
      revokeDriveStream();
    } else {
      revokeDriveBlobUrl();
    }
    setRoomSecret('');

    if (memberSyncInt.current) { clearInterval(memberSyncInt.current); memberSyncInt.current = null; }
    if (roomListener.current) roomListener.current();
    
    const isShareOwner = Boolean((room?.shareHost && username && room.shareHost === username) || amSharing);
    await stopShare(isShareOwner);
    
    setView('home');
    setRoom(null);
    setMessages([]);
    setYtUrl('');
    setRoomId('');
    setParticipants([]);
    setVideoId(null);
    setPlayer(null);
    setDriveTapNeeded(false);
    isHost.current = false;
  };

  if (view === 'home') {
    return (
      <Home 
        username={username}
        setUsername={setUsername}
        roomId={roomId}
        setRoomId={setRoomId}
        loading={loading}
        create={create}
        join={join}
        myAvatar={myAvatar}
        setMyAvatar={setMyAvatar}
        avOpts={avOpts}
        lastHostRoom={lastHostRoom}
        rejoinAsHost={rejoinAsHost}
      />
    );
  }

  return (
    <Room
      containerRef={containerRef}
      vidRef={vidRef}
      driveVideoRef={driveVideoRef}
      room={room}
      isHost={isHost.current}
      participants={participants}
      copied={copied}
      copy={copy}
      leave={leave}
      videoId={videoId}
      vidSrc={vidSrc}
      isFs={isFs}
      floatMsgs={floatMsgs}
      toggleFs={toggleFs}
      ytUrl={ytUrl}
      setYtUrl={setYtUrl}
      load={load}
      startShare={startShare}
      stopShare={stopShare}
      togglePlay={togglePlay}
      messages={messages}
      msgInput={msgInput}
      setMsgInput={setMsgInput}
      sendMsg={sendMsg}
      amSharing={amSharing}
      changeQuality={changeQuality}
      currentQuality={currentQuality}
      // Drive-specific props
      isAuthorized={isAuthorized}
      onAuthorize={authorizeGDrive}
      authError={authError}
      driveLoading={driveLoading}
      driveProgress={IS_DRIVE_STREAMING ? 0 : driveProgress}
      driveError={driveError}
      driveMetadata={driveMetadata}
      isStreaming={IS_DRIVE_STREAMING}
      driveTapNeeded={driveTapNeeded}
      onDriveTapToSync={onDriveTapToSync}
      // Phase 6C: Drive timeline props
      onDriveSeekStart={handleDriveSeekStart}
      onDriveSeekCommit={handleDriveSeekCommit}
    />
  );
};

export default WatchPartyApp;
