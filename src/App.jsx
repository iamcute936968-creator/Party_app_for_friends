import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ref, set, push, update, onValue, get as fbGet, onDisconnect, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { database as db, ensureFirebaseUser, firebaseAuth, accountSdk } from './firebaseClient';
import { enrollRoom, validParticipantName, normalizeRoomShare } from './auth/roomAccess';

// Import components and hooks
import Home from './components/Home';
import Room from './components/Room';
import { useWebRTC } from './hooks/useWebRTC';
import { useVoiceChat } from './hooks/useVoiceChat';
import { useStageFullscreen } from './hooks/useStageFullscreen';
import { useDriveAuth } from './hooks/useDriveAuth';
import { useDriveVideo } from './hooks/useDriveVideo';
import { useDriveStream } from './hooks/useDriveStream';
import { useRealtimeConnection } from './hooks/useRealtimeConnection';
import { useParticipantPresence } from './hooks/useParticipantPresence';
import { getOnlineParticipants } from './presence/participantPresence';
import { getRecentMessages } from './chat/messages';
import { useRoomChat } from './hooks/useRoomChat';
import { useRoomReactions } from './hooks/useRoomReactions';
import { useRoomInvite } from './hooks/useRoomInvite';
import { useRoomEntry } from './hooks/useRoomEntry';
import { useMediaLoad } from './hooks/useMediaLoad';
import { useRoomAnimeStream } from './hooks/useRoomAnimeStream';
import { createParadiseApi } from './anime/paradise';
import { animeRoomFields, animeRoomScope, parseAnimeRoomSelection } from './anime/room';
import { attachAnimeHls } from './anime/hls';
import { usePlaybackRecovery } from './hooks/usePlaybackRecovery';
import { playbackFailure } from './media/playbackFailure';
import { getExpectedPosition, reconcilePlayback } from './media/playbackSync';
import { useViewingLibrary } from './hooks/useViewingLibrary';
import { useAnimeWishlist } from './hooks/useAnimeFavorites';
import { useMangaLibrary } from './hooks/useMangaLibrary';
import { useMovieLibrary } from './hooks/useMovieLibrary';
import { createMovieApi } from './movies/api';
import { movieRoomFields, movieRoomScope, movieRoomProgress, parseMovieRoomSelection } from './movies/room';
import { createCineSrcAdapter } from './adapters/CineSrcAdapter';
import { useParticipantFeatures } from './hooks/useParticipantFeatures';
import { mediaLink } from './library/viewingLibrary';
import { parseRoomInvite } from './invites/roomInvite';
import { createIceConfiguration } from './rtc/iceConfiguration';
import { useAccount } from './hooks/useAccount';
import { useAccountProfile } from './hooks/useAccountProfile';
import { useRoomModeration } from './hooks/useRoomModeration';

// Import adapters
import { createYouTubeAdapter } from './adapters/YouTubeAdapter';
import { createHTML5Adapter } from './adapters/HTML5Adapter';

// Feature flag: Phase 7 Drive HTTP Range streaming
const IS_DRIVE_STREAMING = import.meta.env.VITE_DRIVE_STREAMING === 'true';


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
  const [roomAccessError, setRoomAccessError] = useState('');
  const [youtubeAutoplayBlocked, setYoutubeAutoplayBlocked] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [roomSecret, setRoomSecret] = useState('');
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [reactionRecords, setReactionRecords] = useState({ roomId: null, records: null });
  const [ytUrl, setYtUrl] = useState('');
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [participants, setParticipants] = useState([]);
  const entry = useRoomEntry();
  const account = useAccount(firebaseAuth, accountSdk, view === 'room', Boolean(entry.action), entry.isPending);
  const accountProfile = useAccountProfile(db, account.user);
  const library = useViewingLibrary({ db, accountUid: account.user && !account.user.isAnonymous ? account.user.uid : null });
  const animeFavorites = useAnimeWishlist({ db, accountUid: account.user && !account.user.isAnonymous ? account.user.uid : null });
  const mangaLibrary = useMangaLibrary({ db, accountUid: account.user && !account.user.isAnonymous ? account.user.uid : null });
  const movieLibrary = useMovieLibrary({ db, accountUid: account.user && !account.user.isAnonymous ? account.user.uid : null });
  const rememberViewing = library.record;
  const rememberMovie = movieLibrary.record;
  const mediaLoad = useMediaLoad(view === 'room' ? room?.id : null);
  const loading = Boolean(entry.action) || account.pending;
  const [videoId, setVideoId] = useState(null);
  const [player, setPlayer] = useState(null);
  const [vidSrc, setVidSrc] = useState('youtube');
  const [mediaMountGen, setMediaMountGen] = useState(0);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [relayStatus, setRelayStatus] = useState('direct');
  const [lastHostRoom, setLastHostRoom] = useState(null);
  const [ytReady, setYtReady] = useState(false);
  // Drive: whether iOS needs a tap to unlock playback for this member.
  const [driveTapNeeded, setDriveTapNeeded] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const connectionStatus = useRealtimeConnection(db, view === 'room' ? room?.id : null);
  const { ready: presenceReady, error: presenceError, leave: leavePresence, connectionId: presenceConnectionId } =
    useParticipantPresence(db, view === 'room' ? room?.id : null, username);
  const serverTimeOffset = useRef(0);
  const voiceNoteRecords = useRef({ roomId: null, messages: [] });
  const { draft: msgInput, setDraft: setMsgInput, send: sendMsg, status: chatStatus,
    edit: editMessage, editStatus, editError, sendVoice, loadVoice, clearVoice } =
    useRoomChat(db, view === 'room' ? room?.id : null, username, firebaseUser?.uid,
      { recordsRef: voiceNoteRecords, clock: serverTimeOffset, isHost: Boolean(firebaseUser?.uid && room?.hostUid === firebaseUser.uid) });
  const participantFeatures = useParticipantFeatures(db, view === 'room' ? room?.id : null,
    username, firebaseUser?.uid, presenceConnectionId, connectionStatus === 'connected',
    accountProfile.profile.sharePhoto ? accountProfile.profile.photoURL : '');
  const setMessageDraft = (value) => { setMsgInput(value); participantFeatures.typing(value); };
  const sendMessage = () => { void participantFeatures.stopTyping(); return sendMsg(); };


  // All refs
  const containerRef = useRef(null);
  const stageFullscreen = useStageFullscreen(containerRef, view === 'room' ? room?.id : null);
  const isFs = stageFullscreen.active;
  // playerRef now holds a MediaAdapter instance (not a raw YT.Player).
  const playerRef = useRef(null);
  const movieFrameRef = useRef(null);
  const isHost = useRef(false);
  const initialInvite = useRef(null);
  const invite = useRoomInvite(view === 'room' ? room?.id : null,
    roomSecret || (isHost.current ? room?.secret : ''), window.location.origin + window.location.pathname);
  const roomListener = useRef(null);
  const accessLostRef = useRef(null);
  const reactionState = useRoomReactions(db, view === 'room' ? room?.id : null, username,
    reactionRecords.roomId === room?.id ? reactionRecords.records : null,
    connectionStatus === 'connected', serverTimeOffset, firebaseUser?.uid);
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

  // Legacy member sync (pre-Phase-2 rooms without reference-clock fields).
  // Uses adapter methods instead of direct YT API.
  const syncMemberPlayer = useCallback((adapter, currentRoom) => {
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
    } catch { /* A retiring adapter may no longer expose playback state. */ }
  }, []);

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
  const syncMemberPlayerRefClock = useCallback((adapter, currentRoom, offset) => {
    if (getExpectedPosition(currentRoom, offset) === null) return syncMemberPlayer(adapter, currentRoom);
    try {
      const result = reconcilePlayback(adapter, currentRoom, offset);
      if (result?.catch) result.catch(() => setDriveTapNeeded(true));
      return result;
    } catch { /* A retiring adapter cannot change the room clock. */ }
  }, [syncMemberPlayer]);

  const rtcRoomId = view === 'room' ? room?.id : null;
  const rtcUid = firebaseUser?.uid;
  const moderation = useRoomModeration({ database: db, roomId: rtcRoomId, uid: rtcUid, isHost: isHost.current && view === 'room' });
  const getIceConfiguration = useMemo(() => createIceConfiguration({
    proxyUrl: import.meta.env.VITE_TURN_RELAY === 'true' ? import.meta.env.VITE_MEDIA_PROXY_URL : '',
    onStatus: setRelayStatus,
    getAuthorization: async () => {
      const user = await ensureFirebaseUser();
      if (!rtcRoomId || user.uid !== rtcUid || roomRef.current?.id !== rtcRoomId) throw new Error('Room authorization is required.');
      return { roomId: rtcRoomId, roomSecret: roomRef.current.secret, username, uid: user.uid, firebaseIdToken: await user.getIdToken() };
    },
  }), [rtcRoomId, rtcUid, username]);
  const webRTC = useWebRTC(db, rtcRoomId, username, isHost.current, room, connectionStatus === 'connected', rtcUid, getIceConfiguration);
  const { amSharing, canStopShare, startShare, stopShare, reconnectShare, changeQuality, currentQuality, vidRef, shareError, shareStatus, shareMuted } = webRTC;
  const voiceState = useVoiceChat(db, rtcRoomId, username, room, connectionStatus === 'connected', rtcUid, getIceConfiguration);
  const voice = { ...voiceState, relayStatus };

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
    cancelDownload: cancelDriveDownload,
  } = driveVideo;

  // Drive streaming hook (Phase 7.2 Range streaming)
  const driveStream = useDriveStream({
    proxyUrl: import.meta.env.VITE_MEDIA_PROXY_URL,
    getIdToken: async () => (await ensureFirebaseUser()).getIdToken(),
    onUnauthorized: handleDriveUnauthorized,
  });
  const {
    mediaUrl: driveStreamUrl,
    metadata: driveStreamMetadata,
    loading: driveStreamLoading,
    error: driveStreamError,
    loadDriveStream,
    revokeStream: revokeDriveStream,
    cancelStream: cancelDriveStream,
  } = driveStream;

  // Centralized active Drive media resource and states
  const activeDriveUrl = IS_DRIVE_STREAMING ? driveStreamUrl : driveBlobUrl;
  const driveLoading = IS_DRIVE_STREAMING ? driveStreamLoading : driveBlobLoading;
  const driveError = IS_DRIVE_STREAMING ? driveStreamError : driveBlobError;
  const driveMetadata = IS_DRIVE_STREAMING ? driveStreamMetadata : driveBlobMetadata;
  const animeApi = useMemo(() => createParadiseApi({ proxyUrl: import.meta.env.VITE_MEDIA_PROXY_URL || '' }), []);
  const movieApi = useMemo(() => createMovieApi({ proxyUrl: import.meta.env.VITE_MEDIA_PROXY_URL || '' }), []);
  const animeMedia = useRoomAnimeStream({ room: view === 'room' && presenceReady ? room : null, api: animeApi });
  const activeNativeUrl = vidSrc === 'anime' ? animeMedia.sourceUrl : activeDriveUrl;
  const driveExpiresAt = driveStreamMetadata?.expiresAt;
  const activeDriveSecret = roomSecret || (isHost.current ? (room?.secret || '') : '');
  const canRetryDrive = view === 'room' && vidSrc === 'drive' && Boolean(videoId && driveError) &&
    !driveLoading && connectionStatus === 'connected' &&
    (IS_DRIVE_STREAMING ? presenceReady && Boolean(activeDriveSecret) : isAuthorized);

  const retryDrive = () => {
    if (!canRetryDrive || !room || room.isSharing || isLeavingRef.current) return;
    return mediaLoad.run('retry', () => IS_DRIVE_STREAMING ?
      loadDriveStream(videoId, { roomId: room.id, roomSecret: activeDriveSecret, username }) :
      loadDriveVideo(videoId, accessToken));
  };
  const playbackScope = view === 'room' && videoId && !room?.isSharing ? vidSrc === 'anime' ? animeRoomScope(room) : vidSrc === 'movie' ? movieRoomScope(room) : `${room?.id}/${vidSrc}/${videoId}` : null;
  const recoveryEnabled = Boolean(playbackScope) && connectionStatus === 'connected' &&
    (vidSrc !== 'drive' || (IS_DRIVE_STREAMING ? presenceReady && Boolean(activeDriveSecret) : isAuthorized));
  const playback = usePlaybackRecovery(playbackScope, {
    enabled: recoveryEnabled,
    readyTimeout: vidSrc === 'movie' ? 60000 : undefined,
    loading: vidSrc === 'anime' ? animeMedia.loading : driveLoading,
    expiresAt: vidSrc === 'drive' && IS_DRIVE_STREAMING ? driveExpiresAt : undefined,
    refresh: async () => {
      if (vidSrc === 'anime') return animeMedia.reload();
      const previous = playerRef.current;
      if (vidSrc === 'drive' && IS_DRIVE_STREAMING) {
        if (!await loadDriveStream(videoId, { roomId: room.id, roomSecret: activeDriveSecret, username })) return false;
      }
      if (isLeavingRef.current || roomRef.current?.id !== room?.id || roomRef.current?.videoId !== videoId) return false;
      if (playerRef.current === previous) {
        previous?.destroy({ revokeObjectUrl: false });
        playerRef.current = null;
        setPlayer(null);
        setIsBuffering(false);
        setMediaMountGen((generation) => generation + 1);
      }
      return true;
    },
  });
  const { ready: playbackReady, playing: playbackPlaying, report: reportPlaybackFailure } = playback;

  const saveProgress = useCallback((adapter = playerRef.current) => {
    const active = roomRef.current;
    if (!adapter || !active?.videoId || active.isSharing || active.videoSource === 'anime') return;
    try {
      if (active.videoSource === 'movie') {
        const progress = movieRoomProgress(active, adapter);
        if (progress) void rememberMovie(progress).catch(() => {});
        return;
      }
      const position = adapter.getCurrentTime();
      if (!['PLAYING', 'PAUSED', 'ENDED'].includes(adapter.getState()) || !(position > 0)) return;
      rememberViewing({ source: active.videoSource || 'youtube', id: active.videoId,
        title: active.videoSource === 'drive' ? driveMetadata?.name : undefined,
        position, duration: adapter.getDuration() });
    } catch { /* A retired player has no progress to save. */ }
  }, [rememberViewing, rememberMovie, driveMetadata?.name]);
  useEffect(() => {
    if (view !== 'room' || !player || !videoId) return;
    const save = () => saveProgress();
    const hidden = () => { if (document.visibilityState === 'hidden') save(); };
    const timer = setInterval(save, 5000);
    window.addEventListener('pagehide', save); document.addEventListener('visibilitychange', hidden);
    return () => { clearInterval(timer); window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', hidden); };
  }, [view, player, videoId, saveProgress]);

  // Options
  
  const genId = () => Math.random().toString(36).substring(2, 8).toUpperCase();
  const getYt = (u) => { const r = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/; const m = u.match(r); return (m && m[2].length === 11) ? m[2] : null; };
  const getDrive = (u) => { const ps = [/\/file\/d\/([^/]+)/, /id=([^&]+)/, /\/d\/([^/]+)/]; for (const p of ps) { const m = u.match(p); if (m) return m[1]; } return null; };

  // Load last hosted room from localStorage on mount
  useEffect(() => {
    try {
      const savedRoom = localStorage.getItem('lastHostedRoom');
      if (savedRoom) {
        const roomData = JSON.parse(savedRoom);
        setLastHostRoom(roomData);
      }
    } catch { /* Host recovery storage is optional; room entry must still work. */ }
  }, []);

  // Parse room and secret from URL query params on initial load
  useEffect(() => {
    const parsed = parseRoomInvite(window.location.href);
    initialInvite.current = parsed;
    if (parsed) setRoomId(parsed.roomId);
  }, []);

  // Track Firebase server-time offset for reference-clock calculations
  useEffect(() => {
    const offsetRef = ref(db, '.info/serverTimeOffset');
    const unsubscribe = onValue(offsetRef, (snap) => {
      serverTimeOffset.current = snap.val() || 0;
    });
    return () => unsubscribe();
  }, []);

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
    if (view === 'room' && rtcRoomId) {
      const roomRef_ = ref(db, '/rooms/' + rtcRoomId);
      const unsubscribe = onValue(roomRef_, (snapshot) => {
        const rm = normalizeRoomShare(snapshot.val());
        if (!rm) { accessLostRef.current?.(rtcRoomId); return; }
        if (rm) {
          // Chat UI retains only its bounded recent list; do not retain it again in room state.
          const roomState = { ...rm };
          voiceNoteRecords.current = { roomId: rm.id, messages: Object.entries(rm.messages || {}).filter(([, message]) => message?.audio).map(([id, message]) => ({ id, ...message })) };
          delete roomState.messages;
          delete roomState.reactions;
          setRoom(roomState);
          setReactionRecords({ roomId: rm.id, records: rm.reactions ?? null });
          const participantsList = getOnlineParticipants(rm.participants);
          setParticipants(participantsList);
          setMessages(getRecentMessages(rm.messages));
          if (rm.videoId !== videoId || (rm.videoSource || 'youtube') !== vidSrc) {
            setVideoId(rm.videoId || null);
            setVidSrc(rm.videoSource || 'youtube');
          }
          // Sync member player for BOTH youtube and drive sources.
          if (!isHost.current && playerRef.current && (rm.videoSource !== 'anime' || animeRoomScope(rm) === animeRoomScope(roomRef.current)) &&
            (rm.videoSource !== 'movie' || movieRoomScope(rm) === playerRef.current.movieScope)) {
            // Phase 5: substitute frozen PAUSED room when host is disconnected
            // mid-PLAYING, so the sync function naturally pauses at P*.
            const effectiveRoom = getHostInterruptedFrozenRoom(rm) || rm;
            syncMemberPlayerRefClock(playerRef.current, effectiveRoom, serverTimeOffset.current);
          }
        }
      }, () => accessLostRef.current?.(rtcRoomId));
      roomListener.current = unsubscribe;
      return () => {
        unsubscribe();
      };
    }
  }, [view, rtcRoomId, videoId, vidSrc, syncMemberPlayerRefClock]);

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
  }, [syncMemberPlayerRefClock]);

  // YouTube adapter setup
  useEffect(() => {
    setYoutubeAutoplayBlocked(false);
    let disposed = false;
    let initializingPlayback = true;
    let restoringHostPlayback = false;
    setPlayer(null);
    setIsBuffering(false);
    if (videoId && ytReady && window.YT && window.YT.Player && vidSrc === 'youtube') {
      // Destroy previous adapter (YouTube or Drive) before creating a new one.
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      setDriveTapNeeded(false);
      const c = document.getElementById('yt-player');
      if (!c) return;

      const adapter = createYouTubeAdapter('yt-player', videoId, { fs: 0 });
      adapter.onAutoplayBlocked(() => { if (!disposed) setYoutubeAutoplayBlocked(true); });

      adapter.onReady(() => {
        if (disposed) return;
        playbackReady();
        playerRef.current = adapter;
        setPlayer(adapter);
        setTimeout(() => {
          if (disposed) return;
          if (isHost.current) {
            // A returning host must never sync from a stale PLAYING room.
            const hostRoom = roomRef.current;
            const effectiveHostRoom = getHostInterruptedFrozenRoom(hostRoom) || hostRoom;
            if (effectiveHostRoom && (!isNormalizingRef.current || effectiveHostRoom.playbackState !== 'PLAYING')) {
              restoringHostPlayback = effectiveHostRoom.playbackState === 'PLAYING' && adapter.getState() !== 'PLAYING';
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
          initializingPlayback = false;
        }, 500);
      });

      adapter.onBufferingChange((buffering) => {
        if (disposed || playerRef.current !== adapter) return;
        setIsBuffering(buffering);
        if (!buffering && !isHost.current) syncMemberPlayerRefClock(adapter,
          getHostInterruptedFrozenRoom(roomRef.current) || roomRef.current, serverTimeOffset.current);
      });
      adapter.onStateChange(async (stateName) => {
        // Native startup PAUSED events must not replace the saved clock before alignment.
        if (disposed) return;
        if (stateName === 'PLAYING') setYoutubeAutoplayBlocked(false);
        if (initializingPlayback) return;
        if (stateName === 'PLAYING') playbackPlaying();
        if (stateName === 'PAUSED' || stateName === 'ENDED') saveProgress(adapter);
        if (!isHost.current) return;
        if (restoringHostPlayback) {
          restoringHostPlayback = false;
          if (stateName === 'PLAYING' && roomRef.current?.playbackState === 'PLAYING') return;
        }
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
          } catch { /* Connection state reports write availability; later player events may retry. */ }
        }
      });

      adapter.onError((e) => {
        if (!disposed) reportPlaybackFailure(playbackFailure('youtube', e));
      });
    }
    return () => {
      disposed = true;
      if (memberSyncInt.current) {
        clearInterval(memberSyncInt.current);
        memberSyncInt.current = null;
      }
      if (playerRef.current && vidSrc === 'youtube') {
        try { playerRef.current.destroy(); } catch { /* A source switch may already have retired this adapter. */ }
        playerRef.current = null;
      }
    };
  }, [videoId, vidSrc, ytReady, mediaMountGen, playbackScope, playbackReady, playbackPlaying, reportPlaybackFailure, saveProgress, syncMemberPlayerRefClock]);

  // Movie frames implement the same adapter/clock contract as native playback.
  useEffect(() => {
    if (view !== 'room' || vidSrc !== 'movie' || room?.isSharing || !playbackScope || !movieFrameRef.current?.contentWindow) return;
    const adapter = createCineSrcAdapter(movieFrameRef.current.contentWindow);
    adapter.movieScope = playbackScope;
    let disposed = false, restoring = false, initiallyAligned = false;
    const restoringSession = isHost.current && roomRef.current?.playbackState === 'PLAYING';
    const current = () => !disposed && !isLeavingRef.current && movieRoomScope(roomRef.current) === playbackScope;
    const align = (initial = false) => {
      if (!current() || playerRef.current !== adapter || isNormalizingRef.current) return;
      const active = getHostInterruptedFrozenRoom(roomRef.current) || roomRef.current;
      if (restoringSession) restoring = active.playbackState === 'PLAYING' && adapter.getState() !== 'PLAYING';
      const expected = getExpectedPosition(active, serverTimeOffset.current), duration = adapter.getDuration();
      if (initial && !initiallyAligned && (!isHost.current || restoringSession) && expected !== null && Number.isFinite(duration) && duration > 0) {
        initiallyAligned = true;
        if (active.playbackState === 'PLAYING' && adapter.getState() === 'PAUSED') adapter.play();
        adapter.seek(Math.min(expected, duration));
      }
      try { const command = reconcilePlayback(adapter, active, serverTimeOffset.current); command?.catch(() => setDriveTapNeeded(true)); }
      catch { /* A retired iframe cannot affect the room clock. */ }
    };
    const publish = async state => {
      if (!current() || !isHost.current || isNormalizingRef.current || playerRef.current !== adapter) return;
      const position = adapter.getCurrentTime(), playing = state === 'PLAYING';
      try { await update(ref(db, '/rooms/' + roomRef.current.id), { playbackState: playing ? 'PLAYING' : 'PAUSED', anchorTime: position,
        updatedAt: serverTimestamp(), isPlaying: playing, currentTime: position }); } catch { /* The existing connection state reports write availability. */ }
    };
    adapter.onReady(() => {
      if (!current()) return;
      playerRef.current = adapter; setPlayer(adapter); playbackReady(); align(true);
    });
    adapter.onMetadata(() => align(true));
    adapter.onBufferingChange(value => { if (current()) setIsBuffering(value); });
    adapter.onStateChange(state => {
      if (!current()) return;
      if (state === 'PLAYING') { playbackPlaying(); setDriveTapNeeded(false); }
      if (state === 'PAUSED' || state === 'ENDED') saveProgress(adapter);
      if (!isHost.current) { align(); return; }
      if (restoring) { restoring = false; if (state === 'PLAYING' && roomRef.current?.playbackState === 'PLAYING') return; }
      if (suppressNextStateChange.current && state !== 'ENDED') { suppressNextStateChange.current = false; clearTimeout(suppressTimeoutRef.current); suppressTimeoutRef.current = null; return; }
      void publish(state);
    });
    adapter.onSeek(() => {
      if (!current()) return;
      if (!isHost.current) { align(); return; }
      const expected = getExpectedPosition(roomRef.current, serverTimeOffset.current);
      if (expected !== null && Math.abs(expected - adapter.getCurrentTime()) >= .5) void publish(roomRef.current.playbackState);
    });
    adapter.onError(error => { if (current()) reportPlaybackFailure({ message: error.code === 'selection-changed'
      ? 'The player changed episodes. Reload playback to return to the shared episode.'
      : 'This movie or episode could not play. Retry playback or choose another title.', retryable: true }); });
    const timer = setInterval(() => { if (!isHost.current) align(); }, 2000);
    return () => {
      disposed = true; clearInterval(timer); adapter.destroy();
      if (playerRef.current === adapter) { playerRef.current = null; setIsBuffering(false); setPlayer(current => current === adapter ? null : current); }
    };
  }, [view, vidSrc, room?.isSharing, playbackScope, mediaMountGen, playbackReady, playbackPlaying, reportPlaybackFailure, saveProgress]);

  // Native playback shares the room clock; the HLS loader owns anime sources.
  useEffect(() => {
    if (view !== 'room' || room?.isSharing || !['drive', 'anime'].includes(vidSrc) || !activeNativeUrl || !driveVideoRef.current) return;
    setPlayer(null);

    // Destroy any existing adapter (e.g. a previous Drive load).
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }
    setDriveTapNeeded(false);

    setIsBuffering(false);
    const videoEl = driveVideoRef.current;
    const isAnime = vidSrc === 'anime';
    const adapter = isAnime ? createHTML5Adapter(videoEl, undefined, { manageSource: false, handleErrors: false }) : createHTML5Adapter(videoEl, activeNativeUrl);
    const hlsController = isAnime ? new AbortController() : null;
    let restoringHostPlayback = false;
    let disposed = false;

    adapter.onReady(() => {
      if (disposed) return;
      playbackReady();
      playerRef.current = adapter;
      setPlayer(adapter);

      if (isHost.current) {
        // Host: sync from effective room state (same pattern as YouTube).
        const hostRoom = roomRef.current;
        const effectiveHostRoom = getHostInterruptedFrozenRoom(hostRoom) || hostRoom;
        if (effectiveHostRoom && (!isNormalizingRef.current || effectiveHostRoom.playbackState !== 'PLAYING')) {
          restoringHostPlayback = effectiveHostRoom.playbackState === 'PLAYING' && adapter.getState() !== 'PLAYING';
          const playback = syncMemberPlayerRefClock(adapter, effectiveHostRoom, serverTimeOffset.current);
          if (playback && typeof playback.catch === 'function') {
            playback.catch(() => { restoringHostPlayback = false; });
          } else {
            restoringHostPlayback = false;
          }
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

    adapter.onBufferingChange((buffering) => {
      if (disposed || playerRef.current !== adapter) return;
      setIsBuffering(buffering);
      if (!buffering && !isHost.current) syncMemberPlayerRefClock(adapter,
        getHostInterruptedFrozenRoom(roomRef.current) || roomRef.current, serverTimeOffset.current);
    });
    adapter.onStateChange(async (stateName) => {
      if (disposed) return;
      if (stateName === 'PLAYING') playbackPlaying();
      if (stateName === 'PAUSED' || stateName === 'ENDED') saveProgress(adapter);
      if (!isHost.current) return;
      if (playerRef.current !== adapter) return;
      if (restoringHostPlayback) {
        restoringHostPlayback = false;
        // Initial clock-following playback is local recovery, not a host command.
        if (stateName === 'PLAYING' && roomRef.current?.playbackState === 'PLAYING') return;
      }
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
        } catch { /* Connection state reports write availability; later player events may retry. */ }
      }
    });

    adapter.onError((mediaError) => {
      if (!disposed) reportPlaybackFailure(playbackFailure(isAnime ? 'anime' : 'drive', mediaError,
        !isAnime && IS_DRIVE_STREAMING && Number.isFinite(driveExpiresAt) && driveExpiresAt <= Date.now()));
    });

    if (isAnime) {
      const fail = (error) => { if (!disposed) reportPlaybackFailure(playbackFailure('anime', error || 2)); };
      void attachAnimeHls(videoEl, activeNativeUrl, { signal: hlsController.signal, onError: fail }).catch(fail);
    }

    return () => {
      disposed = true;
      if (isAnime) {
        hlsController.abort(); adapter.destroy({ revokeObjectUrl: false });
        if (playerRef.current === adapter) playerRef.current = null;
        setPlayer(current => current === adapter ? null : current);
      }
      if (memberSyncInt.current) {
        clearInterval(memberSyncInt.current);
        memberSyncInt.current = null;
      }
      // Do NOT destroy the adapter here — the adapter lifecycle is managed by
      // videoId/vidSrc changes and leave(). Destroying on blobUrl change
      // would remove listeners before the component unmounts.
    };
  }, [view, room?.isSharing, vidSrc, activeNativeUrl, mediaMountGen, playbackScope, playbackReady, playbackPlaying, reportPlaybackFailure, driveExpiresAt, saveProgress, syncMemberPlayerRefClock]);

  // When streaming feature flag is ON: fetch playback ticket when videoId or room auth changes.
  useEffect(() => {
    if (!IS_DRIVE_STREAMING || view !== 'room' || room?.isSharing || !presenceReady) return;
    if (vidSrc === 'drive' && videoId) {
      if (room?.id && activeDriveSecret && username) {
        loadDriveStream(videoId, {
          roomId: room.id,
          roomSecret: activeDriveSecret,
          username,
        });
        return cancelDriveStream;
      }
    }
  }, [view, vidSrc, videoId, room?.id, room?.isSharing, activeDriveSecret, username, loadDriveStream, cancelDriveStream, presenceReady]);

  // When streaming feature flag is OFF: trigger Blob download when videoId or accessToken changes.
  useEffect(() => {
    if (IS_DRIVE_STREAMING || view !== 'room' || room?.isSharing) return;
    if (vidSrc === 'drive' && videoId && accessToken) {
      loadDriveVideo(videoId, accessToken);
      return cancelDriveDownload;
    }
  }, [view, room?.id, room?.isSharing, vidSrc, videoId, accessToken, loadDriveVideo, cancelDriveDownload]);

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

  // Room functions
  const create = () => !account.isTransitioning() && entry.run('create', async () => {
    setRoomAccessError('');
    if (!username.trim()) return 'Enter your name to create a room.';
    if (!validParticipantName(username)) return 'Use a name of 1–40 characters without . # $ [ ] or /.';
    if (!window.crypto?.randomUUID) return 'Your browser cannot create a secure invite. Use a current browser on HTTPS.';
    const user = await ensureFirebaseUser();
    const selectedAnime = selectedMedia?.source === 'anime' ? parseAnimeRoomSelection(selectedMedia) : null;
    const selectedMovie = selectedMedia?.source === 'movie' ? parseMovieRoomSelection(selectedMedia) : null;
    if (selectedMedia?.source === 'anime' && !selectedAnime) return 'Choose a valid anime episode.';
    if (selectedMedia?.source === 'movie' && !selectedMovie) return 'Choose a valid movie or TV episode.';
    const id = genId();
    const secret = crypto.randomUUID();
    const roomRef_ = ref(db, '/rooms/' + id);
    const rm = { 
      id, 
      secret,
      roomSecret: secret,
      host: username, 
      hostUid: user.uid,
      identities: { [username]: user.uid },
      seats: { 0: { uid: user.uid, name: username } },
      participants: {},
      createdAt: Date.now(), 
      videoId: selectedMedia?.id || null,
      videoSource: selectedMedia?.source || 'youtube',
      ...(selectedAnime ? { ...animeRoomFields(selectedAnime), mediaSelectionId: crypto.randomUUID() } : {}),
      ...(selectedMovie ? { ...movieRoomFields(selectedMovie), mediaSelectionId: crypto.randomUUID() } : {}),
      isPlaying: false,
      currentTime: selectedMedia && !selectedMedia.completed ? selectedMedia.position : 0,
      roomName: username + "'s Room",
      // Reference-clock fields (Phase 1: initialized, not yet consumed)
      playbackState: 'PAUSED',
      anchorTime: selectedMedia && !selectedMedia.completed ? selectedMedia.position : 0,
      updatedAt: selectedMedia ? serverTimestamp() : 0
    };
    await set(roomRef_, rm);
    await enrollRoom(db, user, id, username, secret);
    setFirebaseUser(user);
    const recovery = { roomId: id, hostName: username, roomSecret: secret, createdAt: Date.now() };
    setLastHostRoom(recovery);
    try { localStorage.setItem('lastHostedRoom', JSON.stringify(recovery)); }
    catch { /* Keep recovery available in memory if this device cannot persist it. */ }

    isLeavingRef.current = false;
    isHost.current = true;
    setMessages([]);
    setRoom(normalizeRoomShare(rm));
    setRoomSecret(secret);
    setParticipants([]);
    setRoomId(id);
    setVideoId(rm.videoId); setVidSrc(rm.videoSource); setSelectedMedia(null);
    setView('room');
  });

  const rejoinAsHost = () => !account.isTransitioning() && entry.run('rejoin', async () => {
    setRoomAccessError('');
    if (!lastHostRoom || !username.trim()) return 'Enter your name to rejoin the room.';
    const id = lastHostRoom.roomId;
    const roomRef_ = ref(db, '/rooms/' + id);
    const user = await ensureFirebaseUser();
    try { await enrollRoom(db, user, id, username, lastHostRoom.roomSecret); }
    catch (error) { return error.code === 'room-access' ? error.message : 'Could not rejoin the room. Try again.'; }

    const snapshot = await fbGet(roomRef_);
    let rm = normalizeRoomShare(snapshot.val());

    if (rm && rm.hostUid === user.uid && rm.host === username) {
      setFirebaseUser(user);
      // Phase 5: before becoming authoritative, normalize any stale PLAYING
      // clock caused by a previous host-disappearance. This prevents the
      // rejoining host from inheriting an advancing ghost clock.
      rm = await normalizeRoomIfInterrupted(id, rm);

      await push(ref(db, '/rooms/' + id + '/messages'),
        { type: 'system', uid: user.uid, text: username + ' (Host) rejoined', time: new Date().toLocaleTimeString(), timestamp: Date.now() }
      );

      const activeSecret = lastHostRoom.roomSecret || rm.secret || '';
      if (activeSecret) setRoomSecret(activeSecret);

      isLeavingRef.current = false;
      isHost.current = true;
      setMessages(getRecentMessages(rm.messages));
      setRoom(rm);
      setRoomId(id);
      setView('room');
      if (rm.videoId) { setVideoId(rm.videoId); setVidSrc(rm.videoSource || 'youtube'); }
    } else {
      try { localStorage.removeItem('lastHostedRoom'); } catch { /* Clear in-memory recovery below. */ }
      setLastHostRoom(null);
      return 'Room recovery is unavailable. Create or join a room.';
    }
  });

  const join = () => !account.isTransitioning() && entry.run('join', async () => {
    setRoomAccessError('');
    if (!username.trim()) return 'Enter your name to join a room.';
    const target = parseRoomInvite(roomId);
    if (!target) return 'Enter a room code or a valid invite link.';
    const id = target.roomId;
    if (!validParticipantName(username)) return 'Use a name of 1–40 characters without . # $ [ ] or /.';
    const user = await ensureFirebaseUser();
    const secretCandidate = target.secret ??
      (initialInvite.current?.roomId === id ? initialInvite.current.secret : '');
    let acceptedSecret;
    try { acceptedSecret = await enrollRoom(db, user, id, username, secretCandidate); }
    catch (error) {
      if (error.code === 'room-access') return error.message;
      throw error;
    }
    const roomRef_ = ref(db, '/rooms/' + id);
    const snapshot = await fbGet(roomRef_);
    const rm = normalizeRoomShare(snapshot.val());
    if (rm) {
      await push(ref(db, '/rooms/' + id + '/messages'),
        { type: 'system', uid: user.uid, text: username + ' joined', time: new Date().toLocaleTimeString(), timestamp: Date.now() }
      );
      setRoomSecret(acceptedSecret);
      setFirebaseUser(user);

      setMessages(getRecentMessages(rm.messages));
      setRoom(rm);
      setRoomId(id);
      setView('room');
      isLeavingRef.current = false;
      isHost.current = false;
      if (rm.videoId) { setVideoId(rm.videoId); setVidSrc(rm.videoSource || 'youtube'); }
    } else { return 'Room not found. Check your invite and try again.'; }
  });

  // ---------------------------------------------------------------------------
  // Phase 6C: Drive Host Seek Handlers
  // ---------------------------------------------------------------------------

  /**
   * Called when the host begins dragging the timeline slider.
   * Increments the seek generation to invalidate any older pending seek.
   * Wrapped in useCallback so DriveTimeline's React.memo is effective (S-03).
   */
  const handleDriveSeekStart = useCallback(() => {
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
    } catch {
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

  const load = (selection = null) => {
    if (!room || room.isSharing || isLeavingRef.current || isNormalizingRef.current) return;
    return mediaLoad.run('load', async (isCurrent) => {
      let animeSelection = parseAnimeRoomSelection(selection || ytUrl.trim(), window.location.origin);
      let movieSelection = parseMovieRoomSelection(selection || ytUrl.trim(), window.location.origin);
      const url = animeSelection || movieSelection ? '' : selection ? mediaLink(selection) : ytUrl.trim();
      let vid = null;
      let src = 'youtube';
      if (animeSelection) {
        const details = await animeApi.details(animeSelection.id);
        if (!details.episodes.some(item => item.number === animeSelection.episode)) return 'This anime episode is not available. Choose another episode.';
        animeSelection = { ...animeSelection, title: details.title };
        vid = animeSelection.id; src = 'anime';
      } else if (movieSelection) {
        const details = await movieApi.details(movieSelection.kind, movieSelection.id);
        if (movieSelection.kind === 'tv') {
          const season = await movieApi.season(movieSelection.id, movieSelection.season);
          if (!season.episodes.some(episode => episode.number === movieSelection.episode)) return 'This TV episode is not listed. Choose another episode.';
        }
        movieSelection = { ...movieSelection, title: details.title }; vid = movieSelection.id; src = 'movie';
      } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
        vid = getYt(url);
        src = 'youtube';
      } else if (url.includes('drive.google.com')) {
        vid = getDrive(url);
        src = 'drive';
      }

      if (vid && room) {
        // If switching to Drive in fallback mode and not yet authorized, prompt auth first.
        if (src === 'drive' && !IS_DRIVE_STREAMING && !isAuthorized) {
          try {
            await authorizeGDrive();
          } catch {
            return 'Could not authorize Google Drive. Try again.';
          }
        }

        if (!isCurrent() || isLeavingRef.current || roomRef.current?.id !== room.id || roomRef.current?.isSharing) return false;
        // Cancel an in-progress seek only after validation and authorization succeed.
        ++seekGenerationRef.current;
        wasPlayingBeforeSeekRef.current = false;
        const isSameDrive = src === 'drive' && vidSrc === 'drive' && vid === videoId && activeDriveUrl;
        const isSameYouTube = src === 'youtube' && vidSrc === 'youtube' && vid === videoId;
        const previousAdapter = playerRef.current;
        const announcement = push(ref(db, '/rooms/' + room.id + '/messages'));

        // Publish the selection and announcement atomically so retry cannot duplicate
        // an announcement after a partially successful load.
        await update(ref(db, '/rooms/' + room.id), {
          mediaSelectionId: crypto.randomUUID(),
          videoId: vid,
          videoSource: src,
          ...(animeSelection ? animeRoomFields(animeSelection) : { animeEpisode: null, animeTitle: null }),
          ...(movieSelection ? movieRoomFields(movieSelection) : { movieKind: null, movieSeason: null, movieEpisode: null, movieTitle: null }),
          // Legacy fields
          isPlaying: false,
          currentTime: 0,
          // Reference-clock fields — new video starts paused at 0
          playbackState: 'PAUSED',
          anchorTime: 0,
          updatedAt: serverTimestamp(),
          ['messages/' + announcement.key]: {
            type: 'system',
            uid: firebaseUser.uid,
            text: username + ' loaded ' + (src === 'movie' ? movieSelection.title : src === 'anime' ? `${animeSelection.title} · Episode ${animeSelection.episode}` : (src === 'youtube' ? 'YouTube' : 'Google Drive') + ' video'),
            time: new Date().toLocaleTimeString(),
            timestamp: Date.now()
          }
        });
        if (!isCurrent() || isLeavingRef.current) return false;
        if (isSameDrive) {
          // Keep the downloaded resource when deliberately reloading this video.
          playerRef.current?.destroy({ revokeObjectUrl: false });
          playerRef.current = null;
          setPlayer(null);
        } else if (previousAdapter && playerRef.current === previousAdapter) {
          // A source change may already have mounted a new adapter via the room
          // listener. Retire only the previous one after write acknowledgement.
          previousAdapter.destroy();
          playerRef.current = null;
          setPlayer(null);
        }
        if (isSameDrive || isSameYouTube) setMediaMountGen((generation) => generation + 1);
        setDriveTapNeeded(false);
        setVideoId(vid);
        setVidSrc(src);
      } else {
        return 'Enter a valid YouTube, Google Drive, Watch Party anime, movie or TV watch link.';
      }
    });
  };

  const togglePlay = async () => {
    if (isNormalizingRef.current) return;
    if (!room || !playerRef.current) return;
    const adapter = playerRef.current;
    const commandScope = vidSrc === 'anime' ? animeRoomScope(roomRef.current) : vidSrc === 'movie' ? movieRoomScope(roomRef.current) : null;
    const commandGeneration = seekGenerationRef.current;
    const isCurrentCommand = () => !isLeavingRef.current && roomRef.current?.id === room.id &&
      playerRef.current === adapter && seekGenerationRef.current === commandGeneration &&
      (commandScope === null || (vidSrc === 'movie' ? movieRoomScope(roomRef.current) : animeRoomScope(roomRef.current)) === commandScope);

    // Use reference-clock field — not the legacy isPlaying field — to determine
    // the toggled state. isPlaying is kept for schema compatibility only.
    const playing = room.playbackState !== 'PLAYING';
    let t = 0;
    try {
      t = adapter.getCurrentTime();

      if (vidSrc === 'drive' || vidSrc === 'anime') {
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
            if (!isCurrentCommand()) return;
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
        if (!isCurrentCommand()) return;
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
    } catch {
      if (!isCurrentCommand()) return;
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

  const toggleFs = stageFullscreen.toggle;

  const leave = async () => {
    saveProgress();
    await participantFeatures.leave();
    isLeavingRef.current = true;
    void voice.leave();
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
      } catch { /* Leaving must continue when the final playback write is unavailable. */ }

      // Mark the session node offline and cancel its queued onDisconnect so it
      // doesn't fire redundantly after the connection closes.
      if (hostSessionRef.current) {
        try {
          await onDisconnect(hostSessionRef.current).cancel();
        } catch { /* The queued disconnect remains a fallback if cancellation fails. */ }
        try {
          await update(hostSessionRef.current, { online: false, endedAt: serverTimestamp() });
        } catch { /* Continue local teardown even if host-presence cleanup is unavailable. */ }
        hostSessionRef.current = null;
        hostSessionIdLocal.current = null;
      }
    }

    if (room && username) {
      try {
        const lastConnection = await leavePresence();
        if (lastConnection) await push(ref(db, '/rooms/' + room.id + '/messages'), {
          type: 'system', 
          uid: firebaseUser.uid,
          text: username + ' left', 
          time: new Date().toLocaleTimeString(), 
          timestamp: Date.now() 
        });
      } catch { /* An unavailable leave announcement must not prevent local teardown. */ }
    }
    
    // Destroy adapter (revokes Drive ObjectURL if applicable).
    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch { /* A concurrent source change may already have retired this adapter. */ }
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

  const resumeLibrary = (item) => {
    if (!isHost.current || !playerRef.current || room?.isSharing || item.id !== videoId || item.source !== vidSrc) return;
    handleDriveSeekStart(item.position);
    return handleDriveSeekCommit(item.position);
  };

  accessLostRef.current = (id) => {
    if (roomRef.current?.id !== id || isLeavingRef.current) return;
    isLeavingRef.current = true;
    ++seekGenerationRef.current;
    wasPlayingBeforeSeekRef.current = false;
    clearTimeout(normalizationTimeoutRef.current); normalizationTimeoutRef.current = null;
    isNormalizingRef.current = false;
    // Stop local media before optional network cleanup can wait for connectivity.
    void voice.leave(); void stopShare(false); void participantFeatures.leave();
    try { playerRef.current?.destroy(); } catch { /* A retiring adapter cannot retain access. */ }
    playerRef.current = null;
    try { driveVideoRef.current?.pause(); driveVideoRef.current?.removeAttribute('src'); driveVideoRef.current?.load(); } catch { /* Detached element. */ }
    revokeDriveStream(); revokeDriveBlobUrl();
    if (memberSyncInt.current) clearInterval(memberSyncInt.current);
    memberSyncInt.current = null;
    roomListener.current?.(); roomListener.current = null;
    roomRef.current = null; isHost.current = false;
    setRoom(null); setRoomSecret(''); setParticipants([]); setMessages([]); setReactionRecords({ roomId: null, records: null });
    setVideoId(null); setPlayer(null); setYtUrl(''); setDriveTapNeeded(false); setView('home');
    setRoomAccessError('Your room access ended. Ask the host for access before joining again.');
  };

  if (view === 'home') {
    return (
      <Home 
        account={{ ...account, pending: account.pending || Boolean(entry.action) }}
        accountProfile={accountProfile}
        animeFavorites={animeFavorites} mangaLibrary={mangaLibrary} movieLibrary={movieLibrary} youtubeReady={ytReady} accountScope={account.user && !account.user.isAnonymous ? account.user.uid : 'guest'}
        username={username}
        setUsername={setUsername}
        roomId={roomId}
        setRoomId={setRoomId}
        loading={loading}
        entryAction={entry.action}
        entryError={entry.error || roomAccessError}
        create={create}
        join={join}
        lastHostRoom={lastHostRoom}
        rejoinAsHost={rejoinAsHost}
        participantFeatures={participantFeatures}
        library={library} selectedMedia={selectedMedia} chooseLibrary={setSelectedMedia}
      />
    );
  }

  return (
    <Room
      moderation={moderation}
      account={account}
      participantFeatures={participantFeatures} typingOffset={serverTimeOffset.current}
      library={library} chooseLibrary={load} resumeLibrary={resumeLibrary}
      animeFavorites={animeFavorites} movieLibrary={movieLibrary}
      containerRef={containerRef}
      vidRef={vidRef}
      driveVideoRef={driveVideoRef}
      room={room}
      username={username}
      screenCaptureSupported={webRTC.canCaptureScreen}
      isHost={isHost.current}
      participants={participants}
      connectionStatus={connectionStatus}
      presenceError={presenceError}
      copied={invite.status === 'copied'}
      copy={invite.copy}
      shareInvite={invite.share}
      inviteUrl={invite.url}
      inviteStatus={invite.status}
      inviteError={invite.error}
      leave={leave}
      videoId={videoId}
      vidSrc={vidSrc}
      animeMedia={animeMedia}
      movieFrameRef={movieFrameRef}
      moviePlayerGeneration={mediaMountGen}
      mediaAdapter={player}
      youtubeAutoplayBlocked={youtubeAutoplayBlocked}
      isFs={isFs}
      toggleFs={toggleFs}
      ytUrl={ytUrl}
      setYtUrl={setYtUrl}
      load={load}
      mediaAction={mediaLoad.action}
      mediaError={mediaLoad.error}
      mediaLoaded={mediaLoad.loaded}
      startShare={startShare}
      stopShare={stopShare}
      reconnectShare={reconnectShare}
      shareError={shareError}
      shareStatus={shareStatus}
      shareMuted={shareMuted}
      voice={voice}
      togglePlay={togglePlay}
      isBuffering={isBuffering}
      isPlaybackReady={Boolean(player)}
      messages={messages}
      msgInput={msgInput}
      setMsgInput={setMessageDraft}
      sendMsg={sendMessage}
      chatStatus={chatStatus}
      chatUserId={firebaseUser?.uid} editMessage={editMessage} editStatus={editStatus} editError={editError}
      sendVoice={sendVoice} loadVoice={loadVoice}
      clearVoice={clearVoice}
      reactions={reactionState.reactions}
      sendReaction={reactionState.send}
      canReact={reactionState.canSend}
      reactionError={reactionState.error}
      amSharing={amSharing}
      canStopShare={canStopShare}
      changeQuality={changeQuality}
      currentQuality={currentQuality}
      // Drive-specific props
      isAuthorized={isAuthorized}
      onAuthorize={() => mediaLoad.run('authorize', async () => { await authorizeGDrive(); })}
      authError={authError}
      driveLoading={driveLoading}
      driveProgress={IS_DRIVE_STREAMING ? 0 : driveProgress}
      driveError={driveError}
      retryDrive={retryDrive}
      canRetryDrive={canRetryDrive}
      playbackError={playback.error}
      recoveryPhase={playback.phase}
      retryPlayback={playback.retry}
      canRetryPlayback={recoveryEnabled}
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
