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

// Hook accepts roomData
export function useWebRTC(db, roomId, username, isRoomHost, roomData) {
  const [isSharing, setIsSharing] = useState(false);
  const [amSharing, setAmSharing] = useState(false);
  const [shareHost, setShareHost] = useState(null);

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
      console.log(`✅✅✅ WebRTC Hook: !!! ontrack EVENT FIRED for ${peerUsername} !!! Streams:`, event.streams);
      if (vidRef.current && event.streams?.[0]) {
        if (vidRef.current.srcObject !== event.streams[0]) {
          console.log('WebRTC Hook: Setting remote stream to video element');
          vidRef.current.srcObject = event.streams[0];
          vidRef.current.muted = false; // Members should NOT be muted
          vidRef.current.play()
            .then(() => console.log("WebRTC Hook: Remote stream playback started."))
            .catch(e => console.error("WebRTC Hook: Error auto-playing remote stream:", e));
          setIsSharing(true);
        } else {
          console.log("WebRTC Hook: ontrack fired, but stream already set.");
        }
      } else {
        console.error("WebRTC Hook: ontrack fired, but vidRef or stream[0] is missing!", { 
          hasVidRef: !!vidRef.current, 
          hasStream0: !!event.streams?.[0] 
        });
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
      console.log(`WebRTC Hook: ICE connection state with ${peerUsername}: ${pc.iceConnectionState}`);
      if (['failed', 'closed'].includes(pc.iceConnectionState)) {
        console.warn(`WebRTC Hook: ICE Connection ${pc.iceConnectionState} with ${peerUsername}. Cleaning up.`);
        if (peerConnections.current[peerUsername]) {
          peerConnections.current[peerUsername].close();
          delete peerConnections.current[peerUsername];
        }
      }
    };

    pc.onsignalingstatechange = () => {
      console.log(`WebRTC Hook: Signaling state for ${peerUsername}: ${pc.signalingState}`);
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

    // Process any pending ICE candidates for this peer
    if (pendingIceCandidates.current[peerUsername]) {
      console.log(`WebRTC Hook: Processing ${pendingIceCandidates.current[peerUsername].length} pending ICE candidates for ${peerUsername}`);
      for (const candidate of pendingIceCandidates.current[peerUsername]) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          console.log(`WebRTC Hook: Added pending ICE candidate for ${peerUsername}`);
        } catch (e) {
          console.error("WebRTC Hook: Error adding pending ICE:", e);
        }
      }
      delete pendingIceCandidates.current[peerUsername];
    }

    return pc;
  }, [db, roomId, username]);

  const stopShare = useCallback(async (updateDb = true) => {
    console.log(`WebRTC Hook: Attempting stopShare... Update DB: ${updateDb}`);
    if (localStream.current) {
      console.log('WebRTC Hook: Stopping local tracks');
      localStream.current.getTracks().forEach(track => { 
        track.onended = null; 
        track.stop(); 
      });
      localStream.current = null;
    }
    const connections = Object.keys(peerConnections.current);
    if (connections.length > 0) {
      console.log('WebRTC Hook: Closing PCs:', connections);
      connections.forEach(peerUsername => { 
        try { 
          peerConnections.current[peerUsername]?.close(); 
        } catch (e) {} 
      });
    }
    peerConnections.current = {};
    pendingIceCandidates.current = {};
    
    if (vidRef.current) {
      console.log('WebRTC Hook: Clearing video element');
      vidRef.current.srcObject = null;
    }

    setIsSharing(false);
    setAmSharing(false);
    setShareHost(null);

    if (updateDb && roomId) {
      console.log('WebRTC Hook: Updating Firebase: isSharing=false');
      try {
        await update(ref(db, `/rooms/${roomId}`), { isSharing: false, shareHost: null });
        await remove(ref(db, `/rooms/${roomId}/webrtc`));
      } catch (error) { 
        console.error("WebRTC Hook: Firebase update on stopShare failed:", error); 
      }
    }
    console.log('WebRTC Hook: Share stopped.');
  }, [db, roomId]);

  const startShare = useCallback(async () => {
    if (!roomId || amSharing) return;
    console.log("WebRTC Hook: Attempting startShare...");
    
    // Clear any active video first
    await update(ref(db, `/rooms/${roomId}`), { 
      videoId: null, 
      videoSource: null, 
      isPlaying: false, 
      currentTime: 0 
    });

    try {
      console.log('WebRTC Hook: Requesting display media...');
      
      // Request high quality screen share with audio
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { 
          cursor: "always",
          displaySurface: "monitor",
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 30 }
        }, 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      console.log('WebRTC Hook: Got stream with constraints');
      localStream.current = stream;

      // Display locally (muted)
      if (vidRef.current) {
        vidRef.current.srcObject = stream;
        vidRef.current.muted = true; // Sharer sees their own screen muted
        vidRef.current.play().catch(e => console.error("WebRTC Hook: Error playing local stream:", e));
      }

      setAmSharing(true);
      setIsSharing(true);
      setShareHost(username);
      console.log('WebRTC Hook: Updating Firebase: isSharing=true');
      await update(ref(db, `/rooms/${roomId}`), { isSharing: true, shareHost: username });

      stream.getTracks().forEach(track => track.onended = () => stopShare(true));

      console.log('WebRTC Hook: Fetching participants for offers...');
      const participantsSnapshot = await fbGet(ref(db, `/rooms/${roomId}/participants`));
      const currentParticipants = participantsSnapshot.val() || {};
      console.log('WebRTC Hook: Participants:', Object.keys(currentParticipants));
      
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

  // Effect for WebRTC Signaling (Offers & Answers)
  useEffect(() => {
    if (!roomId || !username) return;
    let offerListenerUnsubscribe = () => {};
    let answerListenerUnsubscribe = () => {};

    // Member: Listen for offers
    if (!isRoomHost) {
      const offerRef = ref(db, `/rooms/${roomId}/webrtc/offers/${username}`);
      const offerCallback = async (snapshot) => {
        if (snapshot.exists()) {
          const offerData = snapshot.val();
          console.log(`WebRTC Hook Member: Processing offer from ${offerData.from}`);
          
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
            console.log('WebRTC Hook Member: Set remote (offer), creating answer');
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            console.log('WebRTC Hook Member: Set local (answer), sending answer to', offerData.from);
            
            await set(ref(db, `/rooms/${roomId}/webrtc/answers/${offerData.from}`), { 
              from: username, 
              sdp: answer 
            });
          } catch (err) { 
            console.error("WebRTC Hook Member: Error processing offer:", err); 
          } finally { 
            remove(offerRef); 
          }
        }
      };
      offerListenerUnsubscribe = onValue(offerRef, offerCallback, (e) => console.error("Offer listener error:", e));
    }

    // Sharer (Host): Listen for answers
    if (isRoomHost) {
      const answerRef = ref(db, `/rooms/${roomId}/webrtc/answers/${username}`);
      const answerCallback = async (snapshot) => {
        if (snapshot.exists()) {
          const answerData = snapshot.val();
          const peerUsername = answerData.from;
          const pc = peerConnections.current[peerUsername];
          
          if (pc && !pc.currentRemoteDescription) {
            console.log(`WebRTC Hook Sharer: Processing answer from ${peerUsername}`);
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(answerData.sdp));
              console.log('WebRTC Hook Sharer: Set remote (answer)');
            } catch(err) { 
              console.error(`WebRTC Hook Sharer: Error setting remote desc for ${peerUsername}:`, err); 
            } finally { 
              remove(answerRef); 
            }
          } else { 
            console.warn(`WebRTC Hook Sharer: Ans from ${peerUsername}, PC missing/remote set.`); 
            remove(answerRef); 
          }
        }
      };
      answerListenerUnsubscribe = onValue(answerRef, answerCallback, (e) => console.error("Answer listener error:", e));
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
    let iceListenerUnsubscribe = () => {};

    const iceCallback = async (snapshot) => {
      if (snapshot.exists()) {
        console.log(`WebRTC Hook: Received ${snapshot.size} ICE candidate(s)`);
        
        for (const child of snapshot.val() ? Object.keys(snapshot.val()) : []) {
          const childSnapshot = await fbGet(ref(db, `/rooms/${roomId}/webrtc/ice/${username}/${child}`));
          if (!childSnapshot.exists()) continue;
          
          const candidateData = childSnapshot.val();
          const peerUsername = candidateData.from;
          console.log(`WebRTC Hook: Processing ICE from ${peerUsername}`);
          
          const pc = peerConnections.current[peerUsername];
          
          if (pc && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidateData.ice));
              console.log(`WebRTC Hook: Added ICE candidate from ${peerUsername}`);
            } catch (e) {
              console.error("WebRTC Hook: Error adding ICE:", e);
            }
          } else {
            console.log(`WebRTC Hook: Queueing ICE from ${peerUsername} (PC not ready yet)`);
            if (!pendingIceCandidates.current[peerUsername]) {
              pendingIceCandidates.current[peerUsername] = [];
            }
            pendingIceCandidates.current[peerUsername].push(candidateData.ice);
          }
          
          await remove(ref(db, `/rooms/${roomId}/webrtc/ice/${username}/${child}`));
        }
      }
    };

    iceListenerUnsubscribe = onValue(iceRef, iceCallback, (e) => console.error("ICE listener error:", e));
    return () => { iceListenerUnsubscribe(); };
  }, [db, roomId, username]);

  // Effect to sync hook state with DB state from roomData
  useEffect(() => {
    const dbIsSharing = !!roomData?.isSharing;
    const dbShareHost = roomData?.shareHost || null;
    
    if (dbIsSharing !== isSharing) {
      console.log("WebRTC Hook: Syncing isSharing from roomData:", dbIsSharing);
      setIsSharing(dbIsSharing);
    }
    if (dbShareHost !== shareHost) {
      console.log("WebRTC Hook: Syncing shareHost from roomData:", dbShareHost);
      setShareHost(dbShareHost);
    }
    
    if (!isRoomHost && dbIsSharing && dbShareHost !== username && amSharing) {
      console.warn("WebRTC Hook: DB says someone else is sharing, ensuring amSharing is false.");
      setAmSharing(false);
    }
  }, [roomData?.isSharing, roomData?.shareHost, isRoomHost, amSharing, isSharing, shareHost, username]);

  return { 
    isSharing, 
    amSharing, 
    shareHost, 
    startShare, 
    stopShare, 
    vidRef, 
    cleanupWebRTC: () => stopShare(true) 
  };
}