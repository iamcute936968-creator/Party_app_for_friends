import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, set, update, onValue, get as fbGet } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

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
  
  // All refs
  const containerRef = useRef(null);
  const lastMsgRef = useRef(null);
  const playerRef = useRef(null);
  const isHost = useRef(false);
  const syncInt = useRef(null);
  const roomListener = useRef(null);

  // ✅ INTEGRATE WEBRTC HOOK HERE
  const webRTC = useWebRTC(db, roomId, username, isHost.current, room);
  const { isSharing, amSharing, shareHost, startShare, stopShare, vidRef } = webRTC;

  // Options
  const avOpts = [
    { emoji: '😊', color: '#ec4899' }, { emoji: '😎', color: '#8b5cf6' },
    { emoji: '🙂', color: '#3b82f6' }, { emoji: '😄', color: '#f59e0b' },
    { emoji: '😍', color: '#ef4444' }, { emoji: '😉', color: '#10b981' }
  ];
  
  const genId = () => Math.random().toString(36).substring(2, 8).toUpperCase();
  const getYt = (u) => { const r = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/; const m = u.match(r); return (m && m[2].length === 11) ? m[2] : null; };
  const getDrive = (u) => { const ps = [/\/file\/d\/([^/]+)/, /id=([^&]+)/, /\/d\/([^/]+)/]; for (const p of ps) { const m = u.match(p); if (m) return m[1]; } return null; };

  // YouTube API setup
  useEffect(() => {
    const t = document.createElement('script');
    t.src = 'https://www.youtube.com/iframe_api';
    const f = document.getElementsByTagName('script')[0];
    f.parentNode.insertBefore(t, f);
    window.onYouTubeIframeAPIReady = () => console.log('YT Ready');
  }, []);

  // Real-time listener
  useEffect(() => {
    if (view === 'room' && room) {
      const roomRef_ = ref(db, '/rooms/' + room.id);
      console.log('🔥 Starting real-time listener (WebSocket)');
      const unsubscribe = onValue(roomRef_, (snapshot) => {
        const rm = snapshot.val();
        if (rm) {
          console.log('🔥 Real-time update received');
          setRoom(rm);
          setParticipants(Object.keys(rm.participants || {}));
          setMessages(rm.messages || []);
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
        console.log('🔥 Closing real-time listener');
        unsubscribe();
      };
    }
  }, [view, room?.id, videoId, vidSrc]);

  // YouTube player setup
  useEffect(() => {
    if (videoId && window.YT && vidSrc === 'youtube') {
      if (playerRef.current) {
        console.log('🗑️ Destroying old player');
        playerRef.current.destroy();
        playerRef.current = null;
      }
      const c = document.getElementById('yt-player');
      if (!c) {
        console.log('❌ No yt-player element found');
        return;
      }
      console.log('🎬 Creating new YouTube player for video:', videoId);
      const p = new window.YT.Player('yt-player', {
        videoId: videoId,
        playerVars: { controls: 1, disablekb: 0, modestbranding: 1, rel: 0, enablejsapi: 1 },
        events: {
          onReady: (e) => {
            playerRef.current = e.target;
            setPlayer(e.target);
            console.log('🎬 Player ready');
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
            if (room) {
              try {
                const playing = e.data === 1;
                const t = e.target.getCurrentTime();
                await update(ref(db, '/rooms/' + room.id), { isPlaying: playing, currentTime: t });
              } catch (err) { console.log('❌ State change error:', err); }
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
        } catch (e) { console.log('Error destroying player:', e); }
        playerRef.current = null;
      }
    };
  }, [videoId, vidSrc]);

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
      messages: [], 
      roomName: username + "'s Room",
      isSharing: false,
      shareHost: null
    };
    try {
      await set(roomRef_, rm);
      setRoom(rm);
      setParticipants([username]);
      setRoomId(id);
      setView('room');
      isHost.current = true;
    } catch (e) { alert('Failed to create room'); }
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
        await set(ref(db, '/rooms/' + id + '/messages'), [
          ...(rm.messages || []), 
          { type: 'system', text: username + ' joined', time: new Date().toLocaleTimeString(), timestamp: Date.now() }
        ]);
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
    } catch (e) { console.log('❌ Member sync error:', e); }
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
            await update(ref(db, '/rooms/' + room.id), { currentTime: t, isPlaying: playing });
          } catch (e) { console.log('❌ Host sync error:', e); }
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
      alert('Clipboard access is not available. Please use http://localhost or https://');
    }
  };
  
  const sendMsg = async () => {
    if (msgInput.trim() && room) {
      const newMessages = [...messages, { type: 'user', user: username, text: msgInput, time: new Date().toLocaleTimeString(), timestamp: Date.now() }];
      await set(ref(db, '/rooms/' + room.id + '/messages'), newMessages);
      setMsgInput('');
    }
  };

  const load = async () => {
    let vid = null;
    let src = 'youtube';
    if (ytUrl.includes('youtube.com') || ytUrl.includes('youtu.be')) { vid = getYt(ytUrl); src = 'youtube'; }
    else if (ytUrl.includes('drive.google.com')) { vid = getDrive(ytUrl); src = 'drive'; }
    if (vid && room) {
      await update(ref(db, '/rooms/' + room.id), { videoId: vid, videoSource: src, isPlaying: false, currentTime: 0 });
      await set(ref(db, '/rooms/' + room.id + '/messages'), [
        ...messages, 
        { type: 'system', text: username + ' loaded ' + (src === 'youtube' ? 'YouTube' : 'Drive') + ' video', time: new Date().toLocaleTimeString(), timestamp: Date.now() }
      ]);
      setVideoId(vid);
      setVidSrc(src);
    } else { alert('Invalid URL'); }
  };

  const togglePlay = async () => {
    if (!room || vidSrc !== 'youtube' || !playerRef.current) return;
    const playing = !room.isPlaying;
    let t = 0;
    try {
      t = playerRef.current.getCurrentTime();
      await update(ref(db, '/rooms/' + room.id), { isPlaying: playing, currentTime: t });
      if (playing) playerRef.current.playVideo();
      else playerRef.current.pauseVideo();
    } catch (e) { console.log('Toggle play error:', e); }
  };

  const toggleFs = () => {
    if (!document.fullscreenElement) { containerRef.current?.requestFullscreen?.(); setIsFs(true); }
    else { document.exitFullscreen?.(); setIsFs(false); }
  };

  const leave = async () => {
    if (room) {
      const pts = { ...room.participants };
      delete pts[username];
      await update(ref(db, '/rooms/' + room.id), { participants: pts });
    }
    if (playerRef.current) { playerRef.current.destroy(); playerRef.current = null; }
    if (syncInt.current) clearInterval(syncInt.current);
    if (roomListener.current) roomListener.current();
    
    // ✅ Use WebRTC stopShare
    await stopShare(true);
    
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

  // Render
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
      />
    );
  }

  return (
    <Room
      containerRef={containerRef}
      vidRef={vidRef}  // ✅ Pass WebRTC vidRef
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
      startShare={startShare}  // ✅ Pass WebRTC startShare
      stopShare={stopShare}    // ✅ Pass WebRTC stopShare
      togglePlay={togglePlay}
      messages={messages}
      msgInput={msgInput}
      setMsgInput={setMsgInput}
      sendMsg={sendMsg}
    />
  );
};

export default WatchPartyApp;