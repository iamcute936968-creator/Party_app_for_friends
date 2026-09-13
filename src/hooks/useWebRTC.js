// src/hooks/useWebRTC.js
import { useState, useRef, useEffect, useCallback } from 'react';
import { ref, set, update, onValue, off, remove, get as fbGet } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

// WebRTC STUN servers - Including alternatives for restricted regions
const servers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ],
};

// Quality presets
const qualityPresets = {
  'low': { width: 640, height: 360, frameRate: 15 },
  'medium': { width: 1280, height: 720, frameRate: 24 },
  'high': { width: 1920, height: 1080, frameRate: 30 },
  'auto': { width: 1920, height: 1080, frameRate: 30 }
};

export function useWebRTC(db, roomId, username, isRoomHost, roomData) {
  const [isSharing, setIsSharing] = useState(false);
  const [amSharing, setAmSharing] = useState(false);
  const [shareHost, setShareHost] = useState(null);
  const [currentQuality, setCurrentQuality] = useState('high');

  const localStream = useRef(null);
  const peerConnections = useRef({});
  const pendingIceCandidates = useRef({});
  const vidRef = useRef();

  const createPeerConnection = useCallback(async (peerUsername, isOfferer = false) => {
    if (!roomId || !username) {
      return null;
    }
    
    if (peerConnections.current[peerUsername]) {
      return peerConnections.current[peerUsername];
    }

    let pc;
    try { 
      pc = new RTCPeerConnection(servers); 
    } catch (error) { 
      return null; 
    }
    
    peerConnections.current[peerUsername] = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && roomId) {
        const iceRef = ref(db, `/rooms/${roomId}/webrtc/ice/${peerUsername}/${username}_${Date.now()}`);
        set(iceRef, { from: username, ice: event.candidate.toJSON() }).catch(() => {});
      }
    };

    pc.ontrack = (event) => {
      console.log(`🎥 ontrack fired! Peer: ${peerUsername}`, event.streams);
      if (vidRef.current && event.streams?.[0]) {
        console.log('📹 Video ref exists, setting srcObject');
        if (vidRef.current.srcObject !== event.streams[0]) {
          vidRef.current.srcObject = event.streams[0];
          console.log('✅ srcObject set to:', event.streams[0]);
          
          // IMPORTANT: Don't mute for viewers!
          vidRef.current.muted = false;
          vidRef.current.autoplay = true;
          vidRef.current.playsInline = true;
          
          console.log('▶️ Attempting to play video...');
          const playVideo = async () => {
            try {
              await vidRef.current.play();
              console.log('✅ Video playing successfully!');
              setIsSharing(true);
            } catch (err) {
              console.error('❌ Play failed, trying muted:', err);
              // iOS blocks unmuted autoplay, try muted
              vidRef.current.muted = true;
              try {
                await vidRef.current.play();
                console.log('✅ Video playing muted, will unmute in 1s');
                setIsSharing(true);
                // Unmute after 1 second
                setTimeout(() => {
                  if (vidRef.current) {
                    console.log('🔊 Unmuting video');
                    vidRef.current.muted = false;
                  }
                }, 1000);
              } catch (err2) {
                console.error('❌ Even muted play failed:', err2);
                setIsSharing(true);
              }
            }
          };
          
          playVideo();
        } else {
          console.log('⚠️ srcObject already set, skipping');
        }
      } else {
        console.error('❌ Missing vidRef or stream!', {
          hasVidRef: !!vidRef.current,
          hasStream: !!event.streams?.[0]
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        if (peerConnections.current[peerUsername]) {
          peerConnections.current[peerUsername].close();
          delete peerConnections.current[peerUsername];
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.iceConnectionState)) {
        if (peerConnections.current[peerUsername]) {
          peerConnections.current[peerUsername].close();
          delete peerConnections.current[peerUsername];
        }
      }
    };

    if (isOfferer && localStream.current) {
      localStream.current.getTracks().forEach(track => { 
        try { 
          pc.addTrack(track, localStream.current); 
        } catch (e) {} 
      });
    }

    if (isOfferer && roomId) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await set(ref(db, `/rooms/${roomId}/webrtc/offers/${peerUsername}`), { 
          from: username, 
          sdp: offer 
        });
      } catch (err) {}
    }

    if (pendingIceCandidates.current[peerUsername]) {
      for (const candidate of pendingIceCandidates.current[peerUsername]) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {}
      }
      delete pendingIceCandidates.current[peerUsername];
    }

    return pc;
  }, [db, roomId, username]);

  const stopShare = useCallback(async (updateDb = true) => {
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => { 
        track.onended = null; 
        track.stop(); 
      });
      localStream.current = null;
    }
    
    Object.keys(peerConnections.current).forEach(peerUsername => { 
      try { 
        peerConnections.current[peerUsername]?.close(); 
      } catch (e) {} 
    });
    peerConnections.current = {};
    pendingIceCandidates.current = {};
    
    if (vidRef.current) {
      vidRef.current.srcObject = null;
    }

    setIsSharing(false);
    setAmSharing(false);
    setShareHost(null);

    if (updateDb && roomId) {
      try {
        await update(ref(db, `/rooms/${roomId}`), { isSharing: false, shareHost: null });
        await remove(ref(db, `/rooms/${roomId}/webrtc`));
      } catch (error) {}
    }
  }, [db, roomId]);

  const startShare = useCallback(async (quality = 'high') => {
    if (!roomId || amSharing) return;
    
    await update(ref(db, `/rooms/${roomId}`), { 
      videoId: null, 
      videoSource: null, 
      isPlaying: false, 
      currentTime: 0 
    });

    try {
      const preset = qualityPresets[quality] || qualityPresets['high'];
      
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { 
          cursor: "always",
          width: { ideal: preset.width },
          height: { ideal: preset.height },
          frameRate: { ideal: preset.frameRate }
        }, 
        audio: true
      });
      
      localStream.current = stream;
      setCurrentQuality(quality);

      if (vidRef.current) {
        vidRef.current.srcObject = stream;
        vidRef.current.muted = true;
        vidRef.current.play().catch(() => {});
      }

      setAmSharing(true);
      setIsSharing(true);
      setShareHost(username);
      await update(ref(db, `/rooms/${roomId}`), { isSharing: true, shareHost: username });

      stream.getTracks().forEach(track => track.onended = () => stopShare(true));

      const participantsSnapshot = await fbGet(ref(db, `/rooms/${roomId}/participants`));
      const currentParticipants = participantsSnapshot.val() || {};
      
      const offerPromises = Object.keys(currentParticipants)
        .filter(p => p !== username)
        .map(pUsername => createPeerConnection(pUsername, true));

      await Promise.all(offerPromises);
    } catch(err) {
      if (err.name === 'NotAllowedError') alert('Screen sharing permission denied.');
      else alert('Failed to start share.');
      await stopShare(true);
    }
  }, [db, roomId, username, amSharing, createPeerConnection, stopShare]);

  const changeQuality = useCallback(async (newQuality) => {
    if (!amSharing || !localStream.current) {
      return;
    }

    const preset = qualityPresets[newQuality] || qualityPresets['high'];
    const videoTrack = localStream.current.getVideoTracks()[0];
    
    if (videoTrack) {
      try {
        await videoTrack.applyConstraints({
          width: { ideal: preset.width },
          height: { ideal: preset.height },
          frameRate: { ideal: preset.frameRate }
        });
        setCurrentQuality(newQuality);
      } catch (err) {}
    }
  }, [amSharing]);

  useEffect(() => {
    if (!roomId || !username) return;
    let offerListenerUnsubscribe = () => {};
    let answerListenerUnsubscribe = () => {};

    if (!isRoomHost) {
      const offerRef = ref(db, `/rooms/${roomId}/webrtc/offers/${username}`);
      const offerCallback = async (snapshot) => {
        if (snapshot.exists()) {
          const offerData = snapshot.val();
          
          let pc = peerConnections.current[offerData.from];
          if (!pc) { 
            pc = await createPeerConnection(offerData.from, false); 
          }
          if (!pc) { 
            remove(offerRef); 
            return; 
          }

          try {
            await pc.setRemoteDescription(new RTCSessionDescription(offerData.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await set(ref(db, `/rooms/${roomId}/webrtc/answers/${offerData.from}`), { 
              from: username, 
              sdp: answer 
            });
          } catch (err) {} finally { 
            remove(offerRef); 
          }
        }
      };
      offerListenerUnsubscribe = onValue(offerRef, offerCallback);
    }

    if (isRoomHost) {
      const answerRef = ref(db, `/rooms/${roomId}/webrtc/answers/${username}`);
      const answerCallback = async (snapshot) => {
        if (snapshot.exists()) {
          const answerData = snapshot.val();
          const peerUsername = answerData.from;
          const pc = peerConnections.current[peerUsername];
          
          if (pc && !pc.currentRemoteDescription) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(answerData.sdp));
            } catch(err) {} finally { 
              remove(answerRef); 
            }
          } else { 
            remove(answerRef); 
          }
        }
      };
      answerListenerUnsubscribe = onValue(answerRef, answerCallback);
    }

    return () => {
      if (typeof offerListenerUnsubscribe === 'function') offerListenerUnsubscribe();
      if (typeof answerListenerUnsubscribe === 'function') answerListenerUnsubscribe();
    };
  }, [db, roomId, username, isRoomHost, createPeerConnection]);

  useEffect(() => {
    if (!roomId || !username) return;
    const iceRef = ref(db, `/rooms/${roomId}/webrtc/ice/${username}`);

    const iceCallback = async (snapshot) => {
      if (snapshot.exists()) {
        for (const child of snapshot.val() ? Object.keys(snapshot.val()) : []) {
          const childSnapshot = await fbGet(ref(db, `/rooms/${roomId}/webrtc/ice/${username}/${child}`));
          if (!childSnapshot.exists()) continue;
          
          const candidateData = childSnapshot.val();
          const peerUsername = candidateData.from;
          const pc = peerConnections.current[peerUsername];
          
          if (pc && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidateData.ice));
            } catch (e) {}
          } else {
            if (!pendingIceCandidates.current[peerUsername]) {
              pendingIceCandidates.current[peerUsername] = [];
            }
            pendingIceCandidates.current[peerUsername].push(candidateData.ice);
          }
          
          await remove(ref(db, `/rooms/${roomId}/webrtc/ice/${username}/${child}`));
        }
      }
    };

    const unsubscribe = onValue(iceRef, iceCallback);
    return () => { unsubscribe(); };
  }, [db, roomId, username]);

  useEffect(() => {
    const dbIsSharing = !!roomData?.isSharing;
    const dbShareHost = roomData?.shareHost || null;
    
    if (dbIsSharing !== isSharing) {
      setIsSharing(dbIsSharing);
    }
    if (dbShareHost !== shareHost) {
      setShareHost(dbShareHost);
    }
    
    if (!isRoomHost && dbIsSharing && dbShareHost !== username && amSharing) {
      setAmSharing(false);
    }
  }, [roomData?.isSharing, roomData?.shareHost, isRoomHost, amSharing, isSharing, shareHost, username]);

  return { 
    isSharing, 
    amSharing, 
    shareHost, 
    startShare, 
    stopShare, 
    changeQuality,
    currentQuality,
    vidRef, 
    cleanupWebRTC: () => stopShare(true) 
  };
}