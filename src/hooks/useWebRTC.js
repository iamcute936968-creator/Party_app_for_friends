// src/hooks/useWebRTC.js
import { useState, useRef, useEffect, useCallback } from 'react';
import { ref, set, update, onValue, off, remove, get as fbGet } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

// WebRTC STUN servers
const servers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// Quality presets
const qualityPresets = {
  'low': { width: 640, height: 360, frameRate: 15 },
  'medium': { width: 1280, height: 720, frameRate: 24 },
  'high': { width: 1920, height: 1080, frameRate: 30 },
  'auto': { width: 1920, height: 1080, frameRate: 30 }
};

// Hook accepts roomData
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
      console.error("WebRTC Hook: Cannot create PC - missing room/user");
      return null;
    }
    
    if (peerConnections.current[peerUsername]) {
      console.warn("WebRTC Hook: PC already exists for", peerUsername);
      return peerConnections.current[peerUsername];
    }

    console.log(`WebRTC Hook: Creating PC for ${peerUsername}, isOfferer: ${isOfferer}`);
    let pc;
    try { 
      pc = new RTCPeerConnection(servers); 
    } catch (error) { 
      console.error("WebRTC Hook: PC creation failed:", error); 
      return null; 
    }
    
    peerConnections.current[peerUsername] = pc;

    // Event Handlers
    pc.onicecandidate = (event) => {
      if (event.candidate && roomId) {
        console.log(`WebRTC Hook: Sending ICE to ${peerUsername}`);
        const iceRef = ref(db, `/rooms/${roomId}/webrtc/ice/${peerUsername}/${username}_${Date.now()}`);
        set(iceRef, { from: username, ice: event.candidate.toJSON() })
          .catch(err => console.error("WebRTC Hook: Send ICE failed:", err));
      } else if (!event.candidate) { 
        console.log(`WebRTC Hook: ICE gathering finished for ${peerUsername}.`); 
      }
    };

    pc.ontrack = (event) => {
      console.log(`✅ WebRTC Hook: ontrack EVENT for ${peerUsername}`, event.streams);
      if (vidRef.current && event.streams?.[0]) {
        if (vidRef.current.srcObject !== event.streams[0]) {
          console.log('WebRTC Hook: Setting remote stream to video element');
          vidRef.current.srcObject = event.streams[0];
          vidRef.current.muted = false;
          vidRef.current.play()
            .then(() => console.log("WebRTC Hook: Remote stream playback started."))
            .catch(e => console.error("WebRTC Hook: Error auto-playing remote stream:", e));
          setIsSharing(true);
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`WebRTC Hook: Connection state with ${peerUsername}: ${pc.connectionState}`);
      if (['failed', 'closed'].includes(pc.connectionState)) {
        console.warn(`WebRTC Hook: Connection ${pc.connectionState} with ${peerUsername}. Cleaning up.`);
        if (peerConnections.current[peerUsername]) {
          peerConnections.current[peerUsername].close();
          delete peerConnections.current[peerUsername];
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`WebRTC Hook: ICE state with ${peerUsername}: ${pc.iceConnectionState}`);
      if (['failed', 'closed'].includes(pc.iceConnectionState)) {
        if (peerConnections.current[peerUsername]) {
          peerConnections.current[peerUsername].close();
          delete peerConnections.current[peerUsername];
        }
      }
    };

    // Add local stream tracks if I am the offerer (sharer)
    if (isOfferer && localStream.current) {
      console.log('WebRTC Hook: Adding local tracks for', peerUsername);
      localStream.current.getTracks().forEach(track => { 
        try { 
          pc.addTrack(track, localStream.current); 
        } catch (e) { 
          console.error(`AddTrack error: ${e}`); 
        } 
      });
    }

    // If offerer, create and send offer
    if (isOfferer && roomId) {
      console.log(`WebRTC Hook: Creating offer for ${peerUsername}`);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log('WebRTC Hook: Sending offer to', peerUsername);
        await set(ref(db, `/rooms/${roomId}/webrtc/offers/${peerUsername}`), { 
          from: username, 
          sdp: offer 
        });
      } catch (err) { 
        console.error(`WebRTC Hook: Offer error for ${peerUsername}:`, err); 
      }
    }

    // Process pending ICE candidates
    if (pendingIceCandidates.current[peerUsername]) {
      console.log(`WebRTC Hook: Processing ${pendingIceCandidates.current[peerUsername].length} pending ICE for ${peerUsername}`);
      for (const candidate of pendingIceCandidates.current[peerUsername]) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("WebRTC Hook: Error adding pending ICE:", e);
        }
      }
      delete pendingIceCandidates.current[peerUsername];
    }

    return pc;
  }, [db, roomId, username]);

  const stopShare = useCallback(async (updateDb = true) => {
    console.log(`WebRTC Hook: Stopping share...`);
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
      } catch (error) { 
        console.error("WebRTC Hook: Firebase update failed:", error); 
      }
    }
  }, [db, roomId]);

  const startShare = useCallback(async (quality = 'high') => {
    if (!roomId || amSharing) return;
    console.log("WebRTC Hook: Starting share with quality:", quality);
    
    await update(ref(db, `/rooms/${roomId}`), { 
      videoId: null, 
      videoSource: null, 
      isPlaying: false, 
      currentTime: 0 
    });

    try {
      const preset = qualityPresets[quality] || qualityPresets['high'];
      console.log('WebRTC Hook: Requesting display media with preset:', preset);
      
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { 
          cursor: "always",
          width: { ideal: preset.width },
          height: { ideal: preset.height },
          frameRate: { ideal: preset.frameRate }
        }, 
        audio: true
      });
      
      console.log('WebRTC Hook: Got stream');
      localStream.current = stream;
      setCurrentQuality(quality);

      if (vidRef.current) {
        vidRef.current.srcObject = stream;
        vidRef.current.muted = true;
        vidRef.current.play().catch(e => console.error("Error playing local:", e));
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
      console.log('WebRTC Hook: Offers initiated.');
    } catch(err) {
      console.error("WebRTC Hook: Error starting share:", err);
      if (err.name === 'NotAllowedError') alert('Screen sharing permission denied.');
      else alert('Failed to start share.');
      await stopShare(true);
    }
  }, [db, roomId, username, amSharing, createPeerConnection, stopShare]);

  // Change quality while sharing (host only)
  const changeQuality = useCallback(async (newQuality) => {
    if (!amSharing || !localStream.current) {
      console.warn("Not sharing or no stream available");
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
        console.log(`Quality changed to ${newQuality}:`, preset);
      } catch (err) {
        console.error("Failed to change quality:", err);
      }
    }
  }, [amSharing]);

  // Effect for WebRTC Signaling
  useEffect(() => {
    if (!roomId || !username) return;
    let offerListenerUnsubscribe = () => {};
    let answerListenerUnsubscribe = () => {};

    if (!isRoomHost) {
      const offerRef = ref(db, `/rooms/${roomId}/webrtc/offers/${username}`);
      const offerCallback = async (snapshot) => {
        if (snapshot.exists()) {
          const offerData = snapshot.val();
          console.log(`Member: Processing offer from ${offerData.from}`);
          
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
          } catch (err) { 
            console.error("Member: Error processing offer:", err); 
          } finally { 
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
            console.log(`Sharer: Processing answer from ${peerUsername}`);
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(answerData.sdp));
            } catch(err) { 
              console.error(`Sharer: Error setting remote:`, err); 
            } finally { 
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

  // Effect for ICE Candidates
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
            } catch (e) {
              console.error("Error adding ICE:", e);
            }
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

  // Sync with roomData
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