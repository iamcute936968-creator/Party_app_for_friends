import { useState, useRef, useEffect, useCallback } from 'react';
import { ref, set, update, onValue, remove, runTransaction, onDisconnect, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { getOnlineParticipants } from '../presence/participantPresence';

const servers = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:global.stun.twilio.com:3478' },
] };
const presets = {
  low: { width: 640, height: 360, frameRate: 15 }, medium: { width: 1280, height: 720, frameRate: 24 },
  high: { width: 1920, height: 1080, frameRate: 30 }, auto: { width: 1920, height: 1080, frameRate: 30 },
};
const idle = { amSharing: false, shareStatus: 'idle', shareError: '', currentQuality: 'high', shareMuted: false };

export function useWebRTC(db, roomId, username, isRoomHost, roomData, enabled = true, uid = username, getIceConfiguration) {
  const [state, setState] = useState(idle);
  const session = useRef(null);
  const latestRoom = useRef(roomData);
  latestRoom.current = roomData;
  const available = useRef(enabled);
  available.current = enabled;
  const iceConfiguration = useRef(getIceConfiguration);
  iceConfiguration.current = getIceConfiguration;
  const previousAvailability = useRef(enabled);
  const vidRef = useRef(null);

  useEffect(() => {
    const c = { active: true, peers: new Map(), ids: new Map(), broadcasts: new Map(), access: new Map(), ownGrant: undefined, snapshots: {}, ice: new Map(), seenIce: new Set(), handled: new Map(), timers: new Map(), disconnectTimers: new Map(), failures: new Map(), stream: null, id: null, pending: false, generation: 0, requested: '' };
    session.current = c;
    const live = () => c.active && session.current === c;
    const ownAccess = () => typeof latestRoom.current?.hostUid === 'string' && c.ownGrant?.name === username &&
      typeof c.ownGrant?.secret === 'string' && c.ownGrant.secret === latestRoom.current?.secret && latestRoom.current?.identities?.[username] === uid;
    const admissionKey = (name) => `${latestRoom.current?.identities?.[name]}/${latestRoom.current?.secret}`;
    const eligible = (name) => ownAccess() && available.current && name !== username && getOnlineParticipants(latestRoom.current?.participants).includes(name) &&
      typeof latestRoom.current?.identities?.[name] === 'string' && c.access.get(name)?.allowed === true && c.access.get(name)?.key === admissionKey(name);
    const currentPeer = (name, pc) => live() && c.peers.get(name) === pc && eligible(name) &&
      c.broadcasts.get(name) === (c.id || latestRoom.current?.shareSessionId) && (c.stream || latestRoom.current?.shareHost === name);
    const target = (suffix = '') => ref(db, `/rooms/${roomId}${suffix}`);
    const emit = (patch) => { if (live()) setState((old) => ({ ...old, ...patch })); };
    const closePeer = (name) => {
      const pc = c.peers.get(name); c.peers.delete(name);
      if (pc) { pc.ontrack = null; pc.onicecandidate = null; pc.onconnectionstatechange = null; pc.oniceconnectionstatechange = null; pc.close(); }
      if (pc) c.ice.delete(name);
      c.ids.delete(name);
      c.broadcasts.delete(name);
      if (pc && !c.stream && vidRef.current) vidRef.current.srcObject = null;
      clearTimeout(c.timers.get(name)); c.timers.delete(name);
      clearTimeout(c.disconnectTimers.get(name)); c.disconnectTimers.delete(name);
    };
    const release = () => {
      for (const name of [...c.peers.keys()]) closePeer(name);
      for (const timer of c.timers.values()) clearTimeout(timer);
      c.timers.clear();
      c.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
      c.stream = null;
      if (vidRef.current) vidRef.current.srcObject = null;
    };
    const clearBroadcast = (owned) => runTransaction(target('/screenShare'), (share) => share?.ownerUid === uid && share.id === owned ? null : undefined);
    c.stop = async (publish = true, recoverLegacy = false) => {
      const legacy = latestRoom.current?.screenShare;
      const owned = c.id || (recoverLegacy && legacy?.version !== 2 && legacy?.ownerUid === uid ? legacy.id : null);
      const disconnect = c.disconnect;
      c.disconnect = null;
      c.id = null;
      ++c.generation; release(); c.pending = false; c.requested = '';
      emit({ amSharing: false, shareStatus: 'idle', shareError: '' });
      if (publish === false) void disconnect?.cancel().catch(() => {});
      if (publish !== false && owned && roomId) {
        try {
          await clearBroadcast(owned);
          await disconnect?.cancel();
        } catch { emit({ shareError: 'Your screen stopped locally, but room status could not be updated. Try leaving the room.' }); }
      }
    };
    const drainIce = async (name, pc) => {
      for (const entry of c.ice.get(name) || []) {
        if (currentPeer(name, pc) && (!entry.connectionId || entry.connectionId === c.ids.get(name))) await pc.addIceCandidate(entry.ice);
      }
      c.ice.delete(name);
    };
    const fail = (name, expectedPeer) => {
      if (!live() || (expectedPeer && c.peers.get(name) !== expectedPeer)) return;
      closePeer(name);
      const attempts = c.failures.get(name) || 0;
      emit({ shareStatus: c.stream ? 'sharing' : 'disconnected', shareError: 'Screen-share connection interrupted. Reconnect if it does not recover.' });
      if (eligible(name) && attempts < 3) {
        c.failures.set(name, attempts + 1);
        c.timers.set(name, setTimeout(() => { if (live()) void (c.stream ? c.peer(name, true) : c.request()); }, 1000 * 2 ** attempts));
      }
    };
    c.peer = async (name, offerer, connectionId = crypto.randomUUID()) => {
      if (!live() || !available.current || !roomId || !username || !eligible(name)) return null;
      if (c.peers.has(name)) return c.peers.get(name);
      if (c.peers.size >= 5) return null;
      let pc;
      const generation = c.generation;
      try {
        const configuration = iceConfiguration.current ? await iceConfiguration.current() : servers;
        if (!live() || generation !== c.generation || !available.current || !eligible(name)) return null;
        if (c.peers.has(name)) return c.peers.get(name);
        if (c.peers.size >= 5) return null;
        pc = new RTCPeerConnection(configuration); c.peers.set(name, pc); c.ids.set(name, connectionId); c.broadcasts.set(name, c.id || latestRoom.current?.shareSessionId);
        const owned = () => currentPeer(name, pc);
        clearTimeout(c.timers.get(name));
        c.timers.set(name, setTimeout(() => { if (owned() && pc.connectionState !== 'connected') fail(name); }, 10000));
        let iceSequence = 0;
        pc.onicecandidate = (event) => {
          if (owned() && event.candidate) void set(target(`/webrtc/ice/${name}/${username}/${iceSequence++ % 32}`), {
            from: username, sessionId: c.id || latestRoom.current?.shareSessionId || '', connectionId, ice: event.candidate.toJSON?.() || event.candidate,
          }).catch(() => { if (owned()) fail(name); });
        };
        pc.onconnectionstatechange = pc.oniceconnectionstatechange = () => {
          if (!owned()) return;
          const states = [pc.connectionState, pc.iceConnectionState];
          if (states.includes('failed')) { fail(name, pc); return; }
          if (states.includes('disconnected')) {
            if (!c.disconnectTimers.has(name)) {
              emit({ shareStatus: c.stream ? 'sharing' : 'connecting', shareError: 'Network interrupted. Reconnecting to screen share...' });
              c.disconnectTimers.set(name, setTimeout(() => {
                c.disconnectTimers.delete(name);
                if (owned() && [pc.connectionState, pc.iceConnectionState].includes('disconnected')) fail(name, pc);
              }, 8000));
            }
          } else if (states.includes('connected') || states.includes('completed')) {
            clearTimeout(c.disconnectTimers.get(name)); c.disconnectTimers.delete(name);
            c.failures.delete(name); clearTimeout(c.timers.get(name)); c.timers.delete(name);
            emit({ shareError: '', shareStatus: c.stream ? 'sharing' : 'viewing' });
          }
        };
        pc.ontrack = async (event) => {
          const video = vidRef.current;
          if (!owned() || !video || !event.streams?.[0]) return;
          video.srcObject = event.streams[0]; video.muted = false; video.playsInline = true;
          try { await video.play(); if (owned()) emit({ shareStatus: 'viewing', shareError: '', shareMuted: false }); }
          catch {
            if (!owned()) return;
            video.muted = true;
            try { await video.play(); } catch { /* Explicit reconnect provides a new user gesture. */ }
            if (owned()) emit({ shareStatus: 'viewing', shareMuted: true, shareError: 'Use Unmute to hear shared audio. If playback is blocked, reconnect the screen share.' });
          }
        };
        if (offerer && c.stream) {
          c.stream.getTracks().forEach((track) => pc.addTrack(track, c.stream));
          const offer = await pc.createOffer(); if (!owned()) return null;
          await pc.setLocalDescription(offer); if (!owned()) return null;
          await set(target(`/webrtc/offers/${name}`), { from: username, sessionId: c.id, connectionId, sdp: offer });
        }
        return owned() ? pc : null;
      } catch { if (pc) fail(name, pc); else if (live() && generation === c.generation && !c.peers.has(name)) fail(name); return null; }
    };
    c.request = async () => {
      const room = latestRoom.current;
      if (!live() || !room?.isSharing || !room.shareHost || !eligible(room.shareHost)) return;
      if (c.peers.has(room.shareHost)) return;
      emit({ shareStatus: 'connecting', shareError: '' });
      clearTimeout(c.timers.get(room.shareHost));
      c.timers.set(room.shareHost, setTimeout(() => { if (live()) fail(room.shareHost); }, 10000));
      try { await set(target(`/webrtc/requests/${room.shareHost}/${username}`), { from: username, sessionId: room.shareSessionId || '', nonce: crypto.randomUUID(), requestedAt: serverTimestamp() }); }
      catch { if (live() && !c.peers.has(room.shareHost)) fail(room.shareHost); }
    };
    c.reconnect = async () => {
      if (!available.current || c.stream) return;
      if (vidRef.current?.srcObject) { vidRef.current.muted = false; void vidRef.current.play().then(() => emit({ shareMuted: false, shareError: '' })).catch(() => {}); }
      const host = latestRoom.current?.shareHost;
      if (host) { closePeer(host); c.failures.delete(host); }
      await c.request();
    };
    c.start = async (quality = 'high') => {
      if (!live() || !roomId || !username || c.pending || c.stream) return;
      if (!available.current) { emit({ shareError: 'Reconnect to the room before sharing your screen.' }); return; }
      if (!ownAccess()) { emit({ shareError: 'Screen-sharing access is unavailable. Join your room again.' }); return; }
      if (latestRoom.current?.isSharing) { emit({ shareError: 'Someone is already sharing a screen.' }); return; }
      c.pending = true;
      const generation = ++c.generation;
      emit({ shareStatus: 'starting', shareError: '' });
      let stream, id, disconnect;
      try {
        if (!navigator.mediaDevices?.getDisplayMedia) { emit({ shareError: 'Screen sharing is not supported in this browser.', shareStatus: 'idle' }); return; }
        const preset = presets[quality] || presets.high;
        // Capture must begin in the click handler, before the first await.
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always', width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.frameRate } }, audio: true });
        if (!live() || generation !== c.generation || !ownAccess()) { stream.getTracks().forEach((t) => t.stop()); return; }
        c.stream = stream; c.id = id = crypto.randomUUID();
        disconnect = c.disconnect = onDisconnect(target(`/screenShare/connections/${id}`));
        await disconnect.remove();
        if (!live() || generation !== c.generation || !ownAccess()) { await disconnect.cancel(); return; }
        // Child rules reject a competing claim; this multi-location update also
        // clears playback atomically without granting whole-room replacement.
        await update(target(), { screenShare: { version: 2, id, owner: username, ownerUid: uid, connections: { [id]: true } },
          mediaSelectionId: crypto.randomUUID(), videoId: null, videoSource: 'youtube',
          playbackState: 'PAUSED', anchorTime: 0, updatedAt: serverTimestamp(), isPlaying: false, currentTime: 0 });
        if (!live() || generation !== c.generation) { await clearBroadcast(id); await disconnect.cancel(); return; }
        stream.getTracks().forEach((track) => { track.onended = () => c.stop(); });
        if (vidRef.current) { vidRef.current.srcObject = stream; vidRef.current.muted = true; void vidRef.current.play().catch(() => {}); }
        emit({ amSharing: true, shareStatus: 'sharing', shareError: '', currentQuality: presets[quality] ? quality : 'high', shareMuted: true });
        await Promise.all(getOnlineParticipants(latestRoom.current?.participants).filter((name) => name !== username).map((name) => c.peer(name, true)));
      } catch (error) {
        const current = live() && generation === c.generation;
        if (id && c.id === id) await c.stop(); else if (!id) stream?.getTracks().forEach((track) => track.stop());
        if (current) emit({ amSharing: false, shareStatus: 'idle', shareError: error?.name === 'NotAllowedError' ?
          'Screen-sharing permission was not granted. Allow capture and choose a screen to try again.' : error?.name === 'AbortError' ?
          'Screen sharing was cancelled. Choose a screen to try again.' : 'Could not start screen sharing. Try again.' });
      } finally { if (generation === c.generation) c.pending = false; }
    };
    c.quality = async (quality) => {
      const track = c.stream?.getVideoTracks()[0]; const preset = presets[quality];
      if (!track || !preset) return;
      try { await track.applyConstraints({ width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.frameRate } }); emit({ currentQuality: quality }); }
      catch { emit({ shareError: 'Could not change screen-share quality. Try a lower quality.' }); }
    };
    c.sync = () => {
      if (!live()) return;
      const room = latestRoom.current;
      if (c.ownGrant !== undefined && !ownAccess()) {
        void c.stop(false); emit({ shareStatus: 'disconnected', shareError: 'Screen-sharing access was revoked. Join your room again.' }); return;
      }
      for (const [name, entry] of c.access) {
        if (entry.key !== admissionKey(name) || !getOnlineParticipants(room?.participants).includes(name)) {
          entry.unsubscribe?.(); c.access.delete(name); closePeer(name); c.ice.delete(name);
        }
      }
      if (ownAccess()) for (const name of getOnlineParticipants(room?.participants).slice(0, 6)) {
        if (name === username || typeof room?.identities?.[name] !== 'string' || c.access.has(name)) continue;
        const entry = { key: admissionKey(name), allowed: false };
        c.access.set(name, entry);
        const changed = allowed => {
          if (!live() || c.access.get(name) !== entry || entry.key !== admissionKey(name)) return;
          if (entry.allowed === allowed) return;
          entry.allowed = allowed;
          if (!allowed) { closePeer(name); c.ice.delete(name); c.requested = ''; }
          else { c.requested = ''; c.replay?.(); c.sync(); }
        };
        entry.unsubscribe = onValue(ref(db, `/roomAccess/${roomId}/${room.identities[name]}/name`),
          snapshot => changed(snapshot.val() === name), () => { entry.cancelled = true; changed(false); });
      }
      for (const [name, pc] of c.peers) if (!currentPeer(name, pc)) closePeer(name);
      if (c.pending || !ownAccess() || !available.current) return;
      if (c.stream) {
        if (!room?.isSharing || room.shareHost !== username || room.shareSessionId !== c.id) { void c.stop(false); return; }
        for (const name of getOnlineParticipants(room.participants)) if (name !== username && !c.peers.has(name)) void c.peer(name, true);
      } else if (room?.isSharing && room.shareHost !== username) {
        const key = `${room.shareHost}/${room.shareSessionId || ''}`;
        if (c.requested !== key) { c.requested = key; void c.request(); }
      } else {
        if (c.requested) {
          c.requested = ''; for (const name of [...c.peers.keys()]) closePeer(name);
          emit({ shareStatus: 'idle', shareError: '' });
        }
      }
    };
    setState(idle);
    if (!roomId || !username) return () => { c.active = false; release(); };
    const error = reason => {
      if (/permission|unauthorized/i.test(reason?.code || '')) void c.stop(false);
      emit({ shareStatus: 'disconnected', shareError: 'Screen-share updates are unavailable. Reconnect to try again.' });
    };
    const receivers = {};
    const subscribe = (kind, callback) => {
      receivers[kind] = callback;
      return onValue(target(`/webrtc/${kind}/${username}`), snapshot => { c.snapshots[kind] = snapshot.val(); return callback(snapshot); }, error);
    };
    c.replay = () => { for (const [kind, callback] of Object.entries(receivers)) void callback({ val: () => c.snapshots[kind] }); };
    const subscriptions = [
      onValue(ref(db, `/roomAccess/${roomId}/${uid}`), snapshot => { if (live()) {
        const admitted = ownAccess(); c.ownGrant = snapshot.val();
        if (!admitted && ownAccess()) { for (const entry of c.access.values()) entry.unsubscribe?.(); c.access.clear(); c.requested = ''; }
        c.sync();
      } }, () => {
        if (live()) { c.ownGrant = null; c.sync(); }
      }),
      subscribe('offers', async (snapshot) => {
        const offer = snapshot.val(); if (!live() || !available.current || !offer?.from || offer.from === username) return;
        const room = latestRoom.current;
        if (!room?.isSharing || !eligible(offer.from) || offer.from !== room.shareHost || offer.sessionId !== room.shareSessionId) return;
        const key = JSON.stringify(offer); if (c.handled.get('offer') === key) return; c.handled.set('offer', key);
        closePeer(offer.from);
        const pc = await c.peer(offer.from, false, offer.connectionId); if (!pc || !live()) return;
        try {
          await pc.setRemoteDescription(offer.sdp); if (!currentPeer(offer.from, pc)) return;
          await drainIce(offer.from, pc);
          const answer = await pc.createAnswer(); if (!currentPeer(offer.from, pc)) return;
          await pc.setLocalDescription(answer); if (!currentPeer(offer.from, pc)) return;
          await set(target(`/webrtc/answers/${offer.from}/${username}`), { from: username, sessionId: offer.sessionId || '', connectionId: c.ids.get(offer.from), sdp: answer });
          if (live()) await runTransaction(target(`/webrtc/offers/${username}`), (current) => JSON.stringify(current) === key ? null : undefined);
        } catch { fail(offer.from, pc); }
      }, error),
      subscribe('answers', async (snapshot) => {
        const value = snapshot.val(); if (!live() || !value) return;
        // Read legacy single answers as well as per-viewer answers.
        for (const [key, answer] of value.from ? [['', value]] : Object.entries(value)) {
          const pc = c.peers.get(answer?.from);
          if (!pc || !currentPeer(answer.from, pc) || pc.remoteDescription || (answer.sessionId && answer.sessionId !== c.id) || (answer.connectionId && answer.connectionId !== c.ids.get(answer.from))) continue;
          try {
            await pc.setRemoteDescription(answer.sdp);
            if (!currentPeer(answer.from, pc)) continue;
            await drainIce(answer.from, pc);
            if (live() && c.peers.get(answer.from) === pc) await runTransaction(target(`/webrtc/answers/${username}${key ? '/'+key : ''}`),
              (current) => JSON.stringify(current) === JSON.stringify(answer) ? null : undefined);
          }
          catch { fail(answer.from, pc); }
        }
      }, error),
      subscribe('requests', async (snapshot) => {
        if (!live() || !c.stream) return;
        for (const [name, request] of Object.entries(snapshot.val() || {})) {
          const entry = c.access.get(name);
          if (entry?.cancelled && ownAccess() && request?.from === name && request.sessionId === c.id && typeof request.nonce === 'string' &&
              Date.now() - (entry.recheckedAt || 0) >= 1000) {
            entry.unsubscribe?.(); c.access.delete(name); c.sync();
            if (c.access.has(name)) c.access.get(name).recheckedAt = Date.now();
          }
          if (!eligible(name) || request?.from !== name || request.sessionId !== c.id || typeof request.nonce !== 'string' || c.handled.get(name) === request.nonce) continue;
          c.handled.set(name, request.nonce);
          const currentPeer = c.peers.get(name);
          if (currentPeer && !['connected', 'failed', 'disconnected'].includes(currentPeer.connectionState)) continue;
          const last = c.handled.get('time/'+name) || 0;
          if (Date.now() - last < 1000) continue;
          c.handled.set('time/'+name, Date.now()); closePeer(name); await c.peer(name, true);
          if (live()) await runTransaction(target(`/webrtc/requests/${username}/${name}`), (current) => current?.nonce === request.nonce ? null : undefined);
        }
      }, error),
      subscribe('ice', async (snapshot) => {
        if (!live()) return;
        for (const [name, entries] of Object.entries(snapshot.val() || {})) for (const [slot, entry] of Object.entries(entries || {})) {
          const key = `${name}/${slot}`;
          const seenKey = `${entry?.sessionId}/${entry?.connectionId}/${key}`;
          if (entry?.from !== name || !eligible(entry?.from) || c.seenIce.has(seenKey)) continue;
          c.seenIce.add(seenKey);
          if (c.seenIce.size > 256) c.seenIce.delete(c.seenIce.values().next().value);
          const expected = c.id || latestRoom.current?.shareSessionId;
          if (entry.sessionId && expected && entry.sessionId !== expected) continue;
          const pc = c.peers.get(entry.from);
          try {
            if (pc?.remoteDescription && (!entry.connectionId || entry.connectionId === c.ids.get(entry.from))) await pc.addIceCandidate(entry.ice);
            else if ((c.ice.get(entry.from)?.length || 0) < 32) c.ice.set(entry.from, [...(c.ice.get(entry.from) || []), entry]);
            if (live()) await remove(target(`/webrtc/ice/${username}/${key}`));
          } catch { if (pc) fail(entry.from, pc); }
        }
      }, error),
    ];
    const refreshIce = setInterval(async () => {
      if (!live() || !available.current || !c.peers.size || !iceConfiguration.current) return;
      const generation = c.generation;
      try {
        const configuration = await iceConfiguration.current();
        if (live() && generation === c.generation && available.current)
          for (const pc of c.peers.values()) pc.setConfiguration(configuration);
      } catch { /* Preserve working media while credential requests recover. */ }
    }, 60000);
    c.closePeers = () => { for (const name of [...c.peers.keys()]) closePeer(name); c.requested = ''; };
    return () => { c.active = false; clearInterval(refreshIce); subscriptions.forEach((unsubscribe) => unsubscribe?.()); for (const entry of c.access.values()) entry.unsubscribe?.(); c.access.clear(); void c.stop(); };
  }, [db, roomId, username, uid]);

  useEffect(() => { session.current?.sync?.(); }, [roomId, username, roomData]);
  useEffect(() => {
    const c = session.current;
    const previous = previousAvailability.current;
    previousAvailability.current = enabled;
    if (enabled && !previous) { if (latestRoom.current?.isSharing && !c?.stream) void c?.request?.(); else c?.sync?.(); }
    else if (!enabled && c) { c.closePeers?.(); for (const timer of c.timers.values()) clearTimeout(timer); c.timers.clear(); }
  }, [enabled]);
  const startShare = useCallback((quality) => session.current?.start?.(quality), []);
  const stopShare = useCallback((publish = true) => session.current?.stop?.(publish, true), []);
  const reconnectShare = useCallback(() => session.current?.reconnect?.(), []);
  const changeQuality = useCallback((quality) => session.current?.quality?.(quality), []);
  return { ...state, canCaptureScreen: typeof navigator.mediaDevices?.getDisplayMedia === 'function', canStopShare: state.amSharing || Boolean(roomData?.isSharing && roomData.screenShare?.version !== 2 && roomData.screenShare?.ownerUid === uid),
    isSharing: Boolean(roomData?.isSharing || state.amSharing), shareHost: roomData?.shareHost || (state.amSharing ? username : null),
    startShare, stopShare, reconnectShare, changeQuality, vidRef, cleanupWebRTC: stopShare };
}
