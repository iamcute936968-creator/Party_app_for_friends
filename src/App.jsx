import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, set, push, update, onValue, get as fbGet, remove, onDisconnect, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

// Import components and hooks
import Home from './components/Home';
import Room from './components/Room';
import { useWebRTC } from './hooks/useWebRTC';

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
  const [lastHostRoom, setLastHostRoom] = useState(null);
  const [ytReady, setYtReady] = useState(false);
  
  // All refs
  const containerRef = useRef(null);
  const lastMsgRef = useRef(null);
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
  // Zero Firebase operations — local YouTube commands only.
  const memberSyncInt = useRef(null);
  // Phase 5: host-session presence refs.
  // hostSessionRef     — Firebase ref for the currently active host session node.
  // hostSessionIdLocal — string session ID; null before first .info/connected.
  // A new session ID is generated for every .info/connected → true event so
  // that each Firebase connection lifecycle is independently scoped.
  const hostSessionRef = useRef(null);
  const hostSessionIdLocal = useRef(null);

  // Keep roomRef synchronized with the latest room state on every render.
  // This breaks stale closures in onReady callbacks and the reconciliation timer.
  roomRef.current = room;

  // INTEGRATE WEBRTC HOOK
  const webRTC = useWebRTC(db, roomId, username, isHost.current, room);
  const { isSharing, amSharing, shareHost, startShare, stopShare, changeQuality, currentQuality, vidRef } = webRTC;

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
                playerRef.current.seekTo(normalizedRoom.anchorTime, true);
                playerRef.current.pauseVideo();
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
          if (!isHost.current && playerRef.current && vidSrc === 'youtube') {
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

  // YouTube player setup
  useEffect(() => {
    if (videoId && ytReady && window.YT && window.YT.Player && vidSrc === 'youtube') {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      const c = document.getElementById('yt-player');
      if (!c) {
        return;
      }
      const p = new window.YT.Player('yt-player', {
        videoId: videoId,
        playerVars: { 
          controls: 1, 
          disablekb: 0, 
          modestbranding: 1, 
          rel: 0, 
          enablejsapi: 1,
          origin: window.location.origin,
          playsinline: 1 // iOS fix
        },
        events: {
          onReady: (e) => {
            playerRef.current = e.target;
            setPlayer(e.target);
            setTimeout(() => {
              if (isHost.current) {
                // A returning host must never sync from a stale PLAYING room.
                // Use the frozen local interpretation while interrupted, and
                // let the reconnect path publish the normalized room first.
                const hostRoom = roomRef.current;
                const effectiveHostRoom = getHostInterruptedFrozenRoom(hostRoom) || hostRoom;
                if (effectiveHostRoom && (!isNormalizingRef.current || effectiveHostRoom.playbackState !== 'PLAYING')) {
                  syncMemberPlayerRefClock(e.target, effectiveHostRoom, serverTimeOffset.current);
                }
              } else if (roomRef.current) {
                // Initial member sync using ref (avoids stale closure).
                const effectiveRoomOnReady = getHostInterruptedFrozenRoom(roomRef.current) || roomRef.current;
                syncMemberPlayerRefClock(e.target, effectiveRoomOnReady, serverTimeOffset.current);
                // Start local-only reconciliation timer.
                // Catches silent drift (tab throttling, YouTube anomalies) without
                // any Firebase reads or writes.
                if (memberSyncInt.current) clearInterval(memberSyncInt.current);
                memberSyncInt.current = setInterval(() => {
                  if (playerRef.current && roomRef.current && !isHost.current) {
                    const effectiveRoomInterval = getHostInterruptedFrozenRoom(roomRef.current) || roomRef.current;
                    syncMemberPlayerRefClock(playerRef.current, effectiveRoomInterval, serverTimeOffset.current);
                  }
                }, 5000);
              }
            }, 500);
          },
          onStateChange: async (e) => {
            if (!isHost.current) return;
            // Ignore every YouTube event caused by reconnect normalization.
            // This includes buffer recovery, seek-induced pause, and transient
            // events that could otherwise publish the stale local position.
            if (isNormalizingRef.current) return;
            // Ignore transient states: BUFFERING(3), CUED(5), UNSTARTED(-1).
            // Buffering is a local condition and must not pause the room.
            const state = e.data;
            if (state !== 0 && state !== 1 && state !== 2) return;
            // Suppress the duplicate event that follows a togglePlay write.
            if (suppressNextStateChange.current) {
              suppressNextStateChange.current = false;
              // Cancel the fallback timeout — event arrived before it fired.
              if (suppressTimeoutRef.current) {
                clearTimeout(suppressTimeoutRef.current);
                suppressTimeoutRef.current = null;
              }
              return;
            }
            const activeRoom = roomRef.current;
            if (activeRoom) {
              try {
                const t = e.target.getCurrentTime();
                // ENDED(0) → represent as PAUSED at the final position.
                // PLAYING(1) → new anchor at current position.
                // PAUSED(2) → anchor at current position.
                const isPlaying = state === 1;
                const playbackState = isPlaying ? 'PLAYING' : 'PAUSED';
                await update(ref(db, '/rooms/' + activeRoom.id), {
                  // Reference-clock fields
                  playbackState,
                  anchorTime: t,
                  updatedAt: serverTimestamp(),
                  // Legacy fields — kept for member compat until Phase 3 is live
                  isPlaying,
                  currentTime: t
                });
              } catch (err) {}
            }
          }
        }
      });
    }
    return () => {
      if (memberSyncInt.current) {
        clearInterval(memberSyncInt.current);
        memberSyncInt.current = null;
      }
      if (playerRef.current && vidSrc === 'youtube') {
        try {
          playerRef.current.destroy();
        } catch (e) {}
        playerRef.current = null;
      }
    };
  }, [videoId, vidSrc, ytReady]);

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
    const roomRef_ = ref(db, '/rooms/' + id);
    const rm = { 
      id, 
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
        createdAt: Date.now()
      }));
      
      isLeavingRef.current = false;
      isHost.current = true;
      setRoom(rm);
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
    const id = roomId.toUpperCase();
    const roomRef_ = ref(db, '/rooms/' + id);
    try {
      const snapshot = await fbGet(roomRef_);
      const rm = snapshot.val();
      if (rm) {
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
  
  const syncMemberPlayer = (p, currentRoom) => {
    if (!p || !currentRoom) return;
    try {
      const st = p.getPlayerState();
      if (st === -1 || st === 5) return;
      const ct = p.getCurrentTime();
      const tt = currentRoom.currentTime || 0;
      const diff = Math.abs(ct - tt);
      if (diff > 1) {
        p.seekTo(tt, true);
      }
      const shouldPlay = currentRoom.isPlaying;
      const isPlaying = st === 1;
      const isBuffering = st === 3;
      if (shouldPlay && !isPlaying && !isBuffering) {
        p.playVideo();
      } else if (!shouldPlay && isPlaying) {
        p.pauseVideo();
      }
    } catch (e) {}
  };

  /**
   * Member synchronization using the reference clock.
   * Falls back to the legacy syncMemberPlayer when reference-clock data is
   * missing (pre-Phase-2 rooms) or not yet populated.
   *
   * Buffering rules:
   *   PLAYING + buffering  → do not fight buffer; YouTube will resume naturally.
   *   PAUSED  + buffering  → force pause; prevents member auto-playing after buffer.
   */
  const syncMemberPlayerRefClock = (player, currentRoom, offset) => {
    if (!player || !currentRoom) return;
    try {
      const st = player.getPlayerState();
      // UNSTARTED (-1): player not initialised — cannot issue any commands.
      // CUED (5): player is ready but hasn't started; allow reference-clock
      // calculation so late joiners can seek to the correct position.
      if (st === -1) return;

      const expected = getExpectedPosition(currentRoom, offset);

      // Reference clock not valid → use legacy sync as migration fallback
      if (expected === null) {
        syncMemberPlayer(player, currentRoom);
        return;
      }

      const shouldPlay = currentRoom.playbackState === 'PLAYING';
      const ct = player.getCurrentTime();
      const drift = Math.abs(ct - expected);

      // Hard seek when drift exceeds 2-second threshold
      if (drift >= 2) {
        player.seekTo(expected, true);
      }

      const isPlaying = st === 1;
      const isBuffering = st === 3;

      // PLAYING room + buffering → let YouTube resolve buffer naturally.
      // PLAYING room + CUED → st===5: isPlaying=false, isBuffering=false,
      // so playVideo() is called here, starting the video at the seeked position.
      if (shouldPlay && !isPlaying && !isBuffering) {
        player.playVideo();
      // PAUSED room + playing, buffering, OR cued → force pause.
      // The st===5 (CUED) case is required: without it, seekTo() from CUED
      // state leaves the player ready-to-play; not calling pauseVideo() here
      // would allow it to start automatically after the seek resolves.
      } else if (!shouldPlay && (isPlaying || isBuffering || st === 5)) {
        player.pauseVideo();
      }
    } catch (e) {}
  };

  // startHostSync removed in Phase 4.
  // The 500ms legacy heartbeat only wrote isPlaying/currentTime.
  // Reference-clock writes are now fully event-driven via onStateChange and togglePlay.

  const copy = () => { 
    if (navigator.clipboard) {
      navigator.clipboard.writeText(room.id); 
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

  const load = async () => {
    if (isNormalizingRef.current) return;
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
    if (!room || vidSrc !== 'youtube' || !playerRef.current) return;
    // Use reference-clock field — not the legacy isPlaying field — to determine
    // the toggled state. isPlaying is kept for schema compatibility only.
    const playing = room.playbackState !== 'PLAYING';
    let t = 0;
    try {
      t = playerRef.current.getCurrentTime();
      // Publish the authoritative Firebase transition FIRST.
      // The suppression flag is armed AFTER the await so that the Firebase
      // network round-trip is NOT inside the suppression window. Any YouTube
      // events arriving during the await are legitimate and must not be swallowed.
      await update(ref(db, '/rooms/' + room.id), {
        // Reference-clock fields
        playbackState: playing ? 'PLAYING' : 'PAUSED',
        anchorTime: t,
        updatedAt: serverTimestamp(),
        // Legacy fields
        isPlaying: playing,
        currentTime: t
      });
      // Arm suppression immediately before calling the player so only the
      // single onStateChange that follows this call is suppressed.
      if (suppressTimeoutRef.current) clearTimeout(suppressTimeoutRef.current);
      suppressNextStateChange.current = true;
      suppressTimeoutRef.current = setTimeout(() => {
        // Fallback: if YouTube never emits the expected state event (e.g. player
        // was already in that state), clear the flag so the next genuine event
        // is not accidentally swallowed.
        suppressNextStateChange.current = false;
        suppressTimeoutRef.current = null;
      }, 1000);
      if (playing) playerRef.current.playVideo();
      else playerRef.current.pauseVideo();
    } catch (e) {
      // Write or player call failed — clear suppression so no future event is lost.
      if (suppressTimeoutRef.current) clearTimeout(suppressTimeoutRef.current);
      suppressTimeoutRef.current = null;
      suppressNextStateChange.current = false;
    }
  };

  const toggleFs = () => {
    if (!document.fullscreenElement) { containerRef.current?.requestFullscreen?.(); setIsFs(true); }
    else { document.exitFullscreen?.(); setIsFs(false); }
  };

  const leave = async () => {
    isLeavingRef.current = true;
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
          // Cancel the server-side onDisconnect (best-effort — may fail if
          // the connection is already closing, in which case it fires harmlessly).
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
    
    if (playerRef.current) { playerRef.current.destroy(); playerRef.current = null; }
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
    />
  );
};

export default WatchPartyApp;
