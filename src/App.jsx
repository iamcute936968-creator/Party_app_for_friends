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
  const syncInt = useRef(null);
  const roomListener = useRef(null);
  const presenceRef = useRef(null);
  const serverTimeOffset = useRef(0);
  const suppressNextStateChange = useRef(false);
  // Stores the active fallback-timeout ID so we can cancel it if onStateChange
  // consumes the suppression first, preventing a stale timeout from clearing a
  // newer suppression window (generation-safe via cancel-before-create pattern).
  const suppressTimeoutRef = useRef(null);

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
            syncMemberPlayer(playerRef.current, rm);
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
                startHostSync(e.target);
              } else if (room) {
                syncMemberPlayer(e.target, room);
              }
            }, 500);
          },
          onStateChange: async (e) => {
            if (!isHost.current) return;
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
            if (room) {
              try {
                const t = e.target.getCurrentTime();
                // ENDED(0) → represent as PAUSED at the final position.
                // PLAYING(1) → new anchor at current position.
                // PAUSED(2) → anchor at current position.
                const isPlaying = state === 1;
                const playbackState = isPlaying ? 'PLAYING' : 'PAUSED';
                await update(ref(db, '/rooms/' + room.id), {
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
      if (syncInt.current) {
        clearInterval(syncInt.current);
        syncInt.current = null;
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
      
      setRoom(rm);
      setParticipants([username]);
      setRoomId(id);
      setView('room');
      isHost.current = true;
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
      const rm = snapshot.val();
      
      if (rm && rm.host === lastHostRoom.hostName) {
        await update(ref(db, '/rooms/' + id + '/participants'), { [username]: true });
        
        await push(ref(db, '/rooms/' + id + '/messages'), 
          { type: 'system', text: username + ' (Host) rejoined', time: new Date().toLocaleTimeString(), timestamp: Date.now() }
        );
        
        setRoom(rm);
        setRoomId(id);
        setView('room');
        isHost.current = true;
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

  const startHostSync = (p) => {
    if (syncInt.current) clearInterval(syncInt.current);
    if (vidSrc === 'youtube' && p) {
      syncInt.current = setInterval(async () => {
        if (room && isHost.current && p) {
          try {
            const st = p.getPlayerState();
            if (st === -1 || st === 5) return;
            const t = p.getCurrentTime();
            const playing = st === 1;
            if (!playing) return;
            await update(ref(db, '/rooms/' + room.id), { currentTime: t, isPlaying: playing });
          } catch (e) {}
        }
      }, 500);
    }
  };

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
    if (!room || vidSrc !== 'youtube' || !playerRef.current) return;
    const playing = !room.isPlaying;
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
    if (syncInt.current) clearInterval(syncInt.current);
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