import { useCallback, useEffect, useRef, useState } from 'react';
import { ref, set, onValue, onDisconnect, runTransaction, remove } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { getOnlineParticipants } from '../presence/participantPresence';

import { isVoiceActive, voiceLevel, summarizeVoiceStats } from '../voice/voiceState';
export { isVoiceActive, voiceLevel } from '../voice/voiceState';
const idle = { status: 'off', muted: false, error: '', audioBlocked: false, needsMicrophone: false, inputLevel: 0, connectedPeers: 0, expectedPeers: 0, connection: 'off', quality: 'unknown', roundTripMs: null };
const servers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] };

export function useVoiceChat(db, roomId, username, roomData, connected, uid, getIceConfiguration) {
  const [state, setState] = useState(idle);
  const session = useRef(null);
  const latest = useRef({ roomData, connected });
  latest.current = { roomData, connected };
  const iceConfiguration = useRef(getIceConfiguration);
  iceConfiguration.current = getIceConfiguration;
  useEffect(() => {
    const c = { active: true, generation: 0, pending: false, stream: null, id: null, muted: false,
      peers: new Map(), early: new Map(), attempts: new Map(), timers: new Map(), seen: new Set(), context: null, detector: null, disconnect: null, wanted: false, registered: false, registering: false, bindingEpoch: 0, bindingAttempts: 0, bindingTimer: null, monitor: null, snapshots: {}, handledOffers: new Map(), access: new Map(), ownGrant: undefined };
    session.current = c;
    const live = () => c.active && session.current === c;
    const target = (path = '') => ref(db, `/rooms/${roomId}${path}`);
    const emit = (patch) => { if (live()) setState((old) => ({ ...old, ...patch })); };
    const admitted = (name) => c.access.get(name)?.allowed === true && c.access.get(name)?.key === `${latest.current.roomData?.identities?.[name]}/${latest.current.roomData?.voice?.[name]?.id}`;
    const ownAccess = () => c.ownGrant?.name === username && typeof c.ownGrant?.secret === 'string' &&
      c.ownGrant.secret === latest.current.roomData?.secret && latest.current.roomData?.identities?.[username] === uid;
    const eligible = (name) => name !== username && admitted(name) && typeof latest.current.roomData?.identities?.[name] === 'string' &&
      getOnlineParticipants(latest.current.roomData?.participants).includes(name) && isVoiceActive(latest.current.roomData?.voice?.[name]);
    const close = (name) => {
      const peer = c.peers.get(name); c.peers.delete(name);
      clearTimeout(c.timers.get(name)); c.timers.delete(name);
      if (!peer) return;
      clearTimeout(peer.grace);
      peer.pc.oniceconnectionstatechange = null;
      peer.pc.ontrack = peer.pc.onicecandidate = peer.pc.onconnectionstatechange = null;
      peer.pc.close();
      if (peer.audio) { peer.audio.pause(); peer.audio.srcObject = null; }
    };
    const retire = async (id, disconnect) => {
      if (!id) return;
      await runTransaction(target(`/voice/${username}`), (value) => value?.id === id ? null : undefined);
      await disconnect?.cancel();
    };
    const releaseMicrophone = () => {
      clearInterval(c.detector); c.detector = null;
      clearInterval(c.monitor); c.monitor = null;
      if (c.context) { void c.context.close().catch(() => {}); c.context = null; }
      c.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); }); c.stream = null;
    };
    const health = () => {
      const names = Object.keys(latest.current.roomData?.voice || {}).filter(eligible);
      const connectedPeers = [...c.peers.values()].filter((peer) => peer.pc.connectionState === 'connected').length;
      emit({ connectedPeers, expectedPeers: names.length,
        connection: !c.wanted ? 'off' : !c.registered || !latest.current.connected ? 'reconnecting' : !names.length ? 'waiting' : connectedPeers === names.length ? 'connected' : 'connecting' });
    };
    c.stop = async (error = '') => {
      const id = c.id, disconnect = c.disconnect;
      c.wanted = false; c.registered = false; c.registering = false;
      ++c.generation; ++c.bindingEpoch; c.pending = false; c.id = null; c.disconnect = null;
      clearTimeout(c.bindingTimer); c.bindingTimer = null;
      for (const name of [...c.peers.keys()]) close(name);
      for (const timer of c.timers.values()) clearTimeout(timer);
      c.timers.clear(); c.attempts.clear(); c.seen.clear(); c.early.clear(); c.handledOffers.clear();
      for (const entry of c.access.values()) entry.unsubscribe?.(); c.access.clear();
      releaseMicrophone(); emit({ ...idle, error });
      try { await retire(id, disconnect); }
      catch { if (!c.wanted) emit({ error: 'Microphone stopped locally. Voice status could not be updated.' }); }
    };
    c.pause = () => {
      if (!c.wanted) return;
      ++c.bindingEpoch; c.registering = false; c.registered = false;
      clearTimeout(c.bindingTimer); c.bindingTimer = null;
      for (const name of [...c.peers.keys()]) close(name);
      for (const timer of c.timers.values()) clearTimeout(timer);
      c.timers.clear(); c.attempts.clear(); c.early.clear();
      if (c.stream) emit({ status: 'reconnecting', error: '' });
      health();
    };
    const publish = async (speaking) => {
      const id = c.id;
      if (!live() || !c.registered || !latest.current.connected || !id) return;
      try {
        await runTransaction(target(`/voice/${username}`), (current) => current?.id === id ? { ...current, muted: c.muted, speaking: !c.muted && speaking } : undefined);
      } catch { if (c.id === id) emit({ error: 'Voice status is reconnecting. Your microphone setting is preserved.' }); }
    };
    const envelope = (name, connectionId) => ({ from: username, fromSession: c.id,
      toSession: latest.current.roomData?.voice?.[name]?.id, connectionId });
    const fail = (name) => {
      if (!live()) return;
      close(name);
      const attempt = c.attempts.get(name) || 0;
      if (c.stream && c.registered && latest.current.connected && eligible(name)) {
        c.attempts.set(name, Math.min(attempt + 1, 5));
        c.timers.set(name, setTimeout(() => { c.timers.delete(name); if (live()) void c.connect(name); }, Math.min(15000, 1000 * 2 ** attempt)));
      }
      health();
    };
    const drain = async (peer) => {
      for (const entry of peer.ice.splice(0)) if (live() && entry.connectionId === peer.id) await peer.pc.addIceCandidate(entry.ice);
    };
    const create = async (name, offerer, id = crypto.randomUUID()) => {
      if (!live() || !c.registered || !c.stream || !latest.current.connected || !eligible(name)) return null;
      if (c.peers.has(name)) return c.peers.get(name);
      if (c.peers.size >= 5) return null;
      const generation = c.generation;
      const configuration = iceConfiguration.current ? await iceConfiguration.current() : servers;
      if (!live() || generation !== c.generation || !c.registered || !c.stream || !latest.current.connected || !eligible(name)) return null;
      if (c.peers.has(name)) return c.peers.get(name);
      if (c.peers.size >= 5) return null;
      const peer = { pc: new RTCPeerConnection(configuration), id, remoteSession: latest.current.roomData.voice[name].id, ice: [], audio: null };
      peer.ice = (c.early.get(name) || []).filter((entry) => entry.connectionId === id && entry.fromSession === peer.remoteSession);
      c.early.delete(name);
      c.peers.set(name, peer);
      const current = () => live() && c.peers.get(name) === peer && eligible(name) && peer.remoteSession === latest.current.roomData.voice[name].id;
      let sequence = 0;
      c.timers.set(name, setTimeout(() => { if (current() && peer.pc.connectionState !== 'connected') fail(name); }, 20000));
      peer.pc.onicecandidate = (event) => {
        if (current() && event.candidate) void set(target(`/voiceSignals/ice/${name}/${username}/${sequence++ % 32}`),
          { ...envelope(name, peer.id), ice: event.candidate.toJSON?.() || event.candidate }).catch(() => { if (current()) fail(name); });
      };
      peer.pc.onconnectionstatechange = peer.pc.oniceconnectionstatechange = () => {
        if (!current()) return;
        if (peer.pc.connectionState === 'connected') {
          clearTimeout(c.timers.get(name)); c.timers.delete(name); clearTimeout(peer.grace); peer.grace = null;
          c.attempts.delete(name);
        } else if (peer.pc.connectionState === 'disconnected') {
          peer.grace ||= setTimeout(() => { if (current() && peer.pc.connectionState === 'disconnected') fail(name); }, 8000);
        } else if (peer.pc.connectionState === 'failed') fail(name);
        health();
      };
      peer.pc.ontrack = async (event) => {
        if (!current() || !event.streams?.[0]) return;
        peer.audio ||= new Audio(); peer.audio.srcObject = event.streams[0]; peer.audio.autoplay = true;
        try { await peer.audio.play(); }
        catch { if (current()) emit({ audioBlocked: true, error: 'Enable voice audio to hear other participants.' }); }
      };
      c.stream.getAudioTracks().forEach((track) => peer.pc.addTrack(track, c.stream));
      if (offerer) {
        const offer = await peer.pc.createOffer(); if (!current()) return null;
        await peer.pc.setLocalDescription(offer); if (!current()) return null;
        await set(target(`/voiceSignals/offers/${name}/${username}`), { ...envelope(name, peer.id), sdp: offer });
      }
      return current() ? peer : null;
    };
    c.connect = async (name) => {
      if (!live() || !c.registered || !c.stream || !eligible(name) || !latest.current.connected || c.peers.has(name) || c.timers.has(name)) return;
      try {
        if (username < name) await create(name, true);
        else {
          clearTimeout(c.timers.get(name));
          c.timers.set(name, setTimeout(() => { if (live() && !c.peers.has(name)) fail(name); }, 20000));
          await set(target(`/voiceSignals/requests/${name}/${username}`), { ...envelope(name, crypto.randomUUID()), nonce: crypto.randomUUID() });
        }
      } catch { fail(name); }
    };
    c.sync = () => {
      if (c.wanted && c.ownGrant !== undefined && !ownAccess()) { void c.stop('Voice access was revoked. Join your room again.'); return; }
      if (!c.stream || !c.registered || !live() || !latest.current.connected) return;
      const room = latest.current.roomData;
      for (const [name, entry] of c.access) {
        if (entry.key !== `${room?.identities?.[name]}/${room?.voice?.[name]?.id}` || !isVoiceActive(room?.voice?.[name])) {
          entry.unsubscribe?.(); c.access.delete(name); close(name);
        }
      }
      for (const name of Object.keys(room?.voice || {}).slice(0, 6)) {
        if (name === username || !isVoiceActive(room.voice[name]) || typeof room.identities?.[name] !== 'string' || c.access.has(name)) continue;
        const entry = { key: `${room.identities[name]}/${room.voice[name].id}`, allowed: false };
        c.access.set(name, entry);
        const changed = (allowed) => {
          if (!live() || c.access.get(name) !== entry) return;
          entry.allowed = allowed;
          if (!allowed) close(name);
          else { c.replay?.(); c.sync(); }
          health();
        };
        // The leaf read is authorized only while reader and target grants are valid.
        entry.unsubscribe = onValue(ref(db, `/roomAccess/${roomId}/${room.identities[name]}/name`),
          (snapshot) => changed(snapshot.val() === name), () => changed(false));
      }
      for (const [name, peer] of c.peers) if (!eligible(name) || peer.remoteSession !== latest.current.roomData.voice[name].id) close(name);
      for (const name of Object.keys(latest.current.roomData?.voice || {})) {
        if (eligible(name) && !c.peers.has(name) && !c.timers.has(name)) void c.connect(name);
      }
      health();
    };
    c.bind = async () => {
      if (!live() || !c.wanted || !c.stream || !latest.current.connected || c.registering || !ownAccess()) return;
      if (latest.current.roomData?.identities?.[username] !== uid) { await c.stop('Your room identity is no longer available. Join the room again.'); return; }
      c.registering = true; c.registered = false;
      const epoch = ++c.bindingEpoch;
      const current = () => live() && c.wanted && c.stream && latest.current.connected && epoch === c.bindingEpoch;
      const previousId = c.id, previousDisconnect = c.disconnect;
      c.id = null; c.disconnect = null;
      let id, disconnect;
      try {
        await retire(previousId, previousDisconnect);
        if (!current()) return;
        id = crypto.randomUUID(); disconnect = onDisconnect(target(`/voice/${username}/connections/${id}`));
        c.id = id; c.disconnect = disconnect;
        await disconnect.remove();
        if (!current()) { await retire(id, disconnect); return; }
        const claimed = await runTransaction(target(`/voice/${username}`), (value) => !isVoiceActive(value) ? { id, muted: c.muted, speaking: false, connections: { [id]: true } } : undefined);
        if (!current()) { await retire(id, disconnect); return; }
        if (!claimed.committed) { await c.stop('Voice is already active in another tab. Leave voice there first.'); return; }
        c.registered = true; c.bindingAttempts = 0;
        emit({ status: 'joined', muted: c.muted, needsMicrophone: false, error: '' });
        c.replay?.(); c.sync();
      } catch (error) {
        if (!current()) return;
        if (/permission|unauthorized/i.test(error?.code || '')) { await c.stop('Voice access was denied. Join your room again.'); return; }
        emit({ status: 'reconnecting', error: 'Reconnecting voice automatically. Your microphone setting is preserved.' });
        clearTimeout(c.bindingTimer);
        c.bindingTimer = setTimeout(() => { c.bindingTimer = null; void c.bind(); }, Math.min(15000, 1000 * 2 ** Math.min(c.bindingAttempts++, 4)));
      } finally { if (epoch === c.bindingEpoch) c.registering = false; }
    };
    c.join = async () => {
      if (!live() || c.pending || c.stream) return;
      if (!roomId || !uid || !latest.current.connected || latest.current.roomData?.identities?.[username] !== uid ||
        (c.ownGrant !== undefined && !ownAccess())) {
        emit({ error: 'Reconnect to your authorized room before joining voice.' }); return;
      }
      if (!c.wanted) c.muted = false;
      c.wanted = true; c.pending = true; const generation = ++c.generation;
      emit({ status: 'starting', error: '', needsMicrophone: false });
      let stream;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) { c.context = new AudioContext(); void Promise.resolve(c.context.resume?.()).catch(() => {}); }
        // This capture remains inside the explicit Join/Resume user gesture.
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
        if (!live() || generation !== c.generation || !c.wanted) { stream.getTracks().forEach((track) => track.stop()); return; }
        c.stream = stream;
        stream.getAudioTracks().forEach((track) => {
          track.enabled = !c.muted;
          track.onended = () => {
            if (!live() || c.stream !== stream) return;
            c.pause(); const id = c.id, disconnect = c.disconnect; c.id = null; c.disconnect = null;
            releaseMicrophone();
            void retire(id, disconnect).catch(() => {});
            emit({ status: 'reconnecting', needsMicrophone: true, inputLevel: 0, error: 'The browser stopped your microphone. Resume it when you are ready.' });
          };
        });
        if (c.context) {
          const analyser = c.context.createAnalyser(); analyser.fftSize = 512;
          c.context.createMediaStreamSource(stream).connect(analyser);
          const samples = new Uint8Array(analyser.fftSize);
          let lastSound = -Infinity, speaking = false, lastPublished = 0, lastLevel = -1;
          c.detector = setInterval(() => {
            if (!live() || !c.stream) return;
            analyser.getByteTimeDomainData(samples);
            const level = voiceLevel(samples);
            if (level > 0.025) lastSound = Date.now();
            const meter = c.muted ? 0 : Math.min(100, Math.round(level * 250));
            if (Math.abs(meter - lastLevel) >= 5 || (meter === 0 && lastLevel !== 0)) { lastLevel = meter; emit({ inputLevel: meter }); }
            const next = !c.muted && Date.now() - lastSound < 500;
            if (next !== speaking && Date.now() - lastPublished >= 300) { speaking = next; lastPublished = Date.now(); void publish(next); }
          }, 200);
        }
        c.monitor = setInterval(async () => {
          if (!live() || !c.stream) return;
          const epoch = c.bindingEpoch;
          const reports = await Promise.allSettled([...c.peers.values()].map((peer) => peer.pc.getStats?.()));
          if (live() && c.stream && epoch === c.bindingEpoch) { emit(summarizeVoiceStats(reports.filter((item) => item.status === 'fulfilled').map((item) => item.value))); health(); }
        }, 2000);
        if (latest.current.connected) await c.bind();
        else emit({ status: 'reconnecting' });
      } catch (error) {
        if (generation !== c.generation || !live()) return;
        await c.stop(error?.name === 'NotAllowedError' ? 'Microphone permission was not granted. Allow it to join voice.' :
          error?.name === 'NotFoundError' ? 'No microphone was found. Connect one and try again.' :
            error?.message === 'unsupported' ? 'Microphone capture is not supported in this browser.' : 'Could not join voice. Try again.');
      } finally { if (generation === c.generation) c.pending = false; }
    };
    c.toggleMute = async () => {
      if (!c.stream) return;
      c.muted = !c.muted; c.stream.getAudioTracks().forEach((track) => { track.enabled = !c.muted; });
      emit({ muted: c.muted, ...(c.muted ? { inputLevel: 0 } : {}) }); await publish(false);
    };
    c.resumeAudio = async () => {
      if (!c.wanted) return;
      void Promise.resolve(c.context?.resume?.()).catch(() => {});
      const attempts = [...c.peers.values()].filter((peer) => peer.audio).map((peer) => peer.audio.play());
      const result = await Promise.allSettled(attempts);
      if (live()) emit({ audioBlocked: result.some((item) => item.status === 'rejected'), error: result.some((item) => item.status === 'rejected') ? 'Voice audio is still blocked. Check browser sound permissions.' : '' });
    };
    c.reconnect = () => {
      if (!c.stream) { void c.join(); return; }
      if (!c.registered) { void c.bind(); return; }
      for (const name of [...c.peers.keys()]) close(name);
      for (const timer of c.timers.values()) clearTimeout(timer);
      c.timers.clear(); c.attempts.clear(); c.sync();
    };
    const valid = (name, value) => c.registered && latest.current.connected && c.stream && eligible(name) && value?.from === name && value.toSession === c.id &&
      value.fromSession === latest.current.roomData.voice[name].id && typeof value.connectionId === 'string' && value.connectionId.length <= 128;
    const error = (error) => {
      if (/permission|unauthorized/i.test(error?.code || '')) {
        if (c.wanted) void c.stop('Voice access was denied. Join your room again.');
      } else emit({ error: 'Voice updates are unavailable. Reconnect to the room.' });
    };
    setState(idle);
    if (!roomId || !username || !uid) return () => { c.active = false; void c.stop(); };
    const receivers = {};
    const subscribe = (kind, callback) => {
      receivers[kind] = callback;
      return onValue(target(`/voiceSignals/${kind}/${username}`), (snapshot) => { c.snapshots[kind] = snapshot.val(); return callback(snapshot); }, error);
    };
    c.replay = () => { for (const [kind, receive] of Object.entries(receivers)) void receive({ val: () => c.snapshots[kind] }); };
    const subscriptions = [
      onValue(ref(db, `/roomAccess/${roomId}/${uid}`), (snapshot) => {
        if (!live()) return;
        c.ownGrant = snapshot.val();
        if (c.wanted && !ownAccess()) void c.stop('Voice access was revoked. Join your room again.');
        else if (c.wanted && c.stream && !c.registered) void c.bind();
      }, error),
      subscribe('offers', async (snapshot) => {
        for (const [name, offer] of Object.entries(snapshot.val() || {})) {
          if (!live() || !valid(name, offer) || !(name < username) || offer.sdp?.type !== 'offer') continue;
          const handled = c.handledOffers.get(name) || [];
          const key = offer.fromSession + '/' + offer.connectionId;
          if (c.peers.get(name)?.id === offer.connectionId || handled.includes(key)) continue;
          c.handledOffers.set(name, [...handled.slice(-7), key]);
          close(name);
          try {
            const peer = await create(name, false, offer.connectionId); if (!peer) continue;
            await peer.pc.setRemoteDescription(offer.sdp); if (!live() || c.peers.get(name) !== peer) continue;
            await drain(peer);
            const answer = await peer.pc.createAnswer(); if (!live() || c.peers.get(name) !== peer) continue;
            await peer.pc.setLocalDescription(answer); if (!live() || c.peers.get(name) !== peer) continue;
            await set(target(`/voiceSignals/answers/${name}/${username}`), { ...envelope(name, peer.id), sdp: answer });
          } catch { if (live()) fail(name); }
        }
      }),
      subscribe('answers', async (snapshot) => {
        for (const [name, answer] of Object.entries(snapshot.val() || {})) {
          const peer = c.peers.get(name);
          if (!live() || !valid(name, answer) || !peer || peer.id !== answer.connectionId || peer.pc.remoteDescription || answer.sdp?.type !== 'answer') continue;
          try { await peer.pc.setRemoteDescription(answer.sdp); if (live() && c.peers.get(name) === peer) await drain(peer); }
          catch { if (live()) fail(name); }
        }
      }),
      subscribe('requests', async (snapshot) => {
        for (const [name, request] of Object.entries(snapshot.val() || {})) {
          if (!live() || !valid(name, request) || !(username < name) || typeof request.nonce !== 'string') continue;
          const peer = c.peers.get(name);
          const key = 'request/'+name+'/'+request.nonce;
          if (c.seen.has(key)) continue; c.seen.add(key);
          if (c.seen.size > 256) c.seen.delete(c.seen.values().next().value);
          if (peer && peer.pc.connectionState !== 'connected') continue;
          close(name); void c.connect(name);
        }
      }),
      subscribe('ice', async (snapshot) => {
        for (const [name, entries] of Object.entries(snapshot.val() || {})) for (const [key, entry] of Object.entries(entries || {})) {
          if (!live() || !valid(name, entry)) continue;
          const peer = c.peers.get(name); if (peer && peer.id !== entry.connectionId) continue;
          const seen = 'ice/'+name+'/'+entry.connectionId+'/'+key;
          if (c.seen.has(seen)) continue; c.seen.add(seen);
          if (c.seen.size > 256) c.seen.delete(c.seen.values().next().value);
          try {
            if (!peer) {
              const queued = c.early.get(name) || [];
              if (queued.length < 32) c.early.set(name, [...queued, entry]);
            } else if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(entry.ice);
            else if (peer.ice.length < 32) peer.ice.push(entry);
            if (live()) await remove(target(`/voiceSignals/ice/${username}/${name}/${key}`));
          } catch { if (live()) fail(name); }
        }
      }),
    ];
    const resume = () => { if (c.wanted && document.visibilityState !== 'hidden') { void c.resumeAudio(); c.sync(); } };
    const refreshIce = setInterval(async () => {
      if (!live() || !c.registered || !latest.current.connected || !c.peers.size || !iceConfiguration.current) return;
      const generation = c.generation;
      try {
        const configuration = await iceConfiguration.current();
        if (live() && generation === c.generation && c.registered && latest.current.connected)
          for (const peer of c.peers.values()) peer.pc.setConfiguration(configuration);
      } catch { /* Keep the current working connection; admission observers handle revocation. */ }
    }, 60000);
    document.addEventListener('visibilitychange', resume);
    document.addEventListener('pointerdown', resume);
    return () => { c.active = false; clearInterval(refreshIce); document.removeEventListener('visibilitychange', resume); document.removeEventListener('pointerdown', resume); subscriptions.forEach((unsubscribe) => unsubscribe?.()); void c.stop(); };
  }, [db, roomId, username, uid]);
  useEffect(() => { session.current?.sync?.(); }, [roomData]);
  useEffect(() => { const c = session.current; if (!c?.wanted) return; if (!connected) c.pause(); else if (c.stream) void c.bind(); }, [connected]);
  const join = useCallback(() => session.current?.join?.(), []);
  const leave = useCallback(() => session.current?.stop?.(), []);
  const toggleMute = useCallback(() => session.current?.toggleMute?.(), []);
  const resumeAudio = useCallback(() => session.current?.resumeAudio?.(), []);
  const reconnect = useCallback(() => session.current?.reconnect?.(), []);
  // A recording owns these clones; stopping it must not stop the room microphone.
  const recordingStream = useCallback(() => {
    const tracks = session.current?.stream?.getAudioTracks().filter(track => track.readyState === 'live') || [];
    if (!tracks.length) return null;
    return new MediaStream(tracks.map(track => { const copy = track.clone(); copy.enabled = true; return copy; }));
  }, []);
  return { ...state, join, leave, toggleMute, resumeAudio, reconnect, recordingStream };
}
