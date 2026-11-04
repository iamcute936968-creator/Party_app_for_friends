import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVoiceChat, isVoiceActive, voiceLevel } from '../../src/hooks/useVoiceChat';
import { summarizeVoiceStats } from '../../src/voice/voiceState';
import { ref, set, update, onValue, onDisconnect, runTransaction } from '../helpers/firebase-database';
const database = {};
let capture, listeners, errors, record, track, peers, disconnect;
const room = { id: 'ROOM_A', secret: 'fixture-secret', hostUid: 'host-uid', identities: { Host: 'host-uid', Guest: 'guest-uid' }, participants: { Host: true, Guest: true } };
beforeEach(() => {
  vi.clearAllMocks(); listeners = new Map(); errors = new Map(); record = null; peers = [];
  track = { enabled: true, stop: vi.fn() };
  capture = vi.fn().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: capture } });
  ref.mockImplementation((_db, path) => ({ path }));
  onValue.mockImplementation((target, next, error) => {
    listeners.set(target.path, next); errors.set(target.path, error);
    for (const [name, uid] of Object.entries(room.identities)) {
      if (target.path === `/roomAccess/ROOM_A/${uid}`) next({ val: () => ({ name, secret: room.secret }) });
      if (target.path === `/roomAccess/ROOM_A/${uid}/name`) queueMicrotask(() => next({ val: () => name }));
    }
    return () => { listeners.delete(target.path); errors.delete(target.path); };
  });
  disconnect = { remove: vi.fn().mockResolvedValue(), cancel: vi.fn().mockResolvedValue() };
  onDisconnect.mockReturnValue(disconnect); set.mockResolvedValue(); update.mockResolvedValue();
  runTransaction.mockImplementation(async (_target, fn) => { const next = fn(record); if (next === undefined) return { committed: false }; record = next; return { committed: true }; });
  vi.stubGlobal('RTCPeerConnection', class {
    constructor(configuration) { this.configuration = configuration; peers.push(this); this.connectionState = 'new'; }
    close = vi.fn(); addTrack() {} async createOffer() { return { type: 'offer', sdp: 'fixture' }; }
    setConfiguration = vi.fn();
    async createAnswer() { return { type: 'answer', sdp: 'fixture' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { this.remoteDescription = value; }
    async addIceCandidate(value) { (this.receivedIce ||= []).push(value); }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('refreshes ICE on an existing voice peer without replacing the microphone', async () => {
  vi.useFakeTimers();
  const data = { ...room, voice: { Host: { id: 'host-voice', connections: { 'host-voice': true } } } };
  const first = { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] };
  const renewed = { iceServers: [{ urls: 'turn:turn.cloudflare.com:3478', username: 'renewed', credential: 'temporary' }] };
  const getConfiguration = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(renewed);
  const { result } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Guest', data, true, 'guest-uid', getConfiguration));
  await act(async () => result.current.join());
  const peer = peers[0]; peer.connectionState = 'connected';
  await act(async () => peer.onconnectionstatechange());
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(peer.setConfiguration).toHaveBeenCalledWith(renewed);
  expect(capture).toHaveBeenCalledOnce();
  expect(track.stop).not.toHaveBeenCalled();
});
it('uses authenticated relay configuration and discards a response after voice is left', async () => {
  const data = { ...room, voice: { Host: { id: 'host-voice', connections: { 'host-voice': true } } } };
  const configuration = { iceServers: [{ urls: 'turn:turn.cloudflare.com:3478', username: 'temporary', credential: 'temporary' }] };
  const getConfiguration = vi.fn().mockResolvedValue(configuration);
  const { result, unmount } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Guest', data, true, 'guest-uid', getConfiguration));
  await act(async () => result.current.join());
  expect(getConfiguration).toHaveBeenCalled();
  expect(peers[0].configuration).toEqual(configuration);
  unmount(); peers = [];
  let finish;
  getConfiguration.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const second = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Guest', data, true, 'guest-uid', getConfiguration));
  await act(async () => second.result.current.join());
  await act(async () => second.result.current.leave());
  await act(async () => finish(configuration));
  expect(peers).toHaveLength(0);
});
it('never captures on mount; join requests audio synchronously and blocks duplicate capture', async () => {
  const { result } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Host', room, true, 'host-uid'));
  expect(capture).not.toHaveBeenCalled();
  let pending;
  act(() => { pending = result.current.join(); void result.current.join(); });
  expect(capture).toHaveBeenCalledExactlyOnceWith({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
  await act(async () => pending);
  expect(result.current.status).toBe('joined');
  expect(isVoiceActive(record)).toBe(true);
});
it('handles permission denial without publishing voice presence or leaking raw errors', async () => {
  capture.mockRejectedValue(new DOMException('private device details', 'NotAllowedError'));
  const { result } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Host', room, true, 'host-uid'));
  await act(async () => result.current.join());
  expect(result.current.error).toMatch(/permission/i);
  expect(result.current.error).not.toContain('private');
  expect(runTransaction).not.toHaveBeenCalled();
});
it('mutes the actual track, publishes muted state and stops capture on leave', async () => {
  const { result } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Host', room, true, 'host-uid'));
  await act(async () => result.current.join());
  await act(async () => result.current.toggleMute());
  expect(track.enabled).toBe(false);
  expect(record).toMatchObject({ muted: true, speaking: false });
  await act(async () => result.current.leave());
  expect(track.stop).toHaveBeenCalledOnce();
  expect(record).toBeNull();
  expect(disconnect.cancel).toHaveBeenCalled();
});

it('gives a recording its own enabled clone while preserving the room microphone and mute setting', async () => {
  const clone = { enabled: false, readyState: 'live', stop: vi.fn(function () { this.readyState = 'ended'; }) };
  track.readyState = 'live'; track.clone = vi.fn(() => clone);
  vi.stubGlobal('MediaStream', class {
    constructor(tracks) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks; }
  });
  const { result } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Host', room, true, 'host-uid'));
  expect(result.current.recordingStream()).toBeNull();
  await act(async () => result.current.join());
  await act(async () => result.current.toggleMute());
  const recording = result.current.recordingStream();
  expect(recording.getAudioTracks()).toEqual([clone]);
  expect(track.clone).toHaveBeenCalledOnce();
  expect(clone.enabled).toBe(true);
  expect(track.enabled).toBe(false);
  expect(result.current.muted).toBe(true);
  for (const ownedTrack of recording.getTracks()) ownedTrack.stop();
  expect(clone.readyState).toBe('ended');
  expect(track.readyState).toBe('live');
  expect(track.stop).not.toHaveBeenCalled();
  expect(capture).toHaveBeenCalledOnce();
  await act(async () => result.current.leave());
  expect(track.stop).toHaveBeenCalledOnce();
  expect(result.current.recordingStream()).toBeNull();
});
it('stops a late microphone response after leaving without publishing it', async () => {
  let finish;
  capture.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { result, unmount } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Host', room, true, 'host-uid'));
  let pending; act(() => { pending = result.current.join(); });
  unmount();
  await act(async () => { finish({ getTracks: () => [track], getAudioTracks: () => [track] }); await pending; });
  expect(track.stop).toHaveBeenCalledOnce();
  expect(runTransaction).not.toHaveBeenCalled();
});
it('requires room identity and connectivity before asking for microphone permission', async () => {
  const { result } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Guest', room, false, 'host-uid'));
  await act(async () => result.current.join());
  expect(capture).not.toHaveBeenCalled();
});
it('keeps explicit voice opt-in and mute across transport loss, then renews only its session on reconnect', async () => {
  const { result, rerender } = renderHook(({ connected }) => useVoiceChat(database, 'ROOM_A', 'Host', room, connected, 'host-uid'), { initialProps: { connected: true } });
  await act(async () => result.current.join());
  const oldId = record.id;
  await act(async () => result.current.toggleMute());
  await act(async () => rerender({ connected: false }));
  expect(track.stop).not.toHaveBeenCalled();
  expect(result.current.status).toBe('reconnecting');
  expect(result.current.muted).toBe(true);
  await act(async () => rerender({ connected: true }));
  expect(result.current.status).toBe('joined');
  expect(capture).toHaveBeenCalledOnce();
  expect(record.id).not.toBe(oldId);
  expect(record.muted).toBe(true);
  await act(async () => result.current.leave());
  expect(track.stop).toHaveBeenCalledOnce();
  expect(result.current.status).toBe('off');
});

it('lets a briefly disconnected peer recover without destroying its connection', async () => {
  vi.useFakeTimers();
  const data = { ...room, voice: { Host: { id: 'host-voice', connections: { 'host-voice': true } } } };
  const { result } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Guest', data, true, 'guest-uid'));
  await act(async () => result.current.join());
  const peer = peers[0];
  await act(async () => { peer.connectionState = 'connected'; peer.onconnectionstatechange(); });
  await act(async () => { peer.connectionState = 'disconnected'; peer.onconnectionstatechange(); await vi.advanceTimersByTimeAsync(3000); });
  expect(peer.close).not.toHaveBeenCalled();
  await act(async () => { peer.connectionState = 'connected'; peer.onconnectionstatechange(); await vi.advanceTimersByTimeAsync(10000); });
  expect(peer.close).not.toHaveBeenCalled();
  expect(result.current.status).toBe('joined');
  expect(result.current.connectedPeers).toBe(1);
});

it('continues bounded-backoff reconnection beyond three failures until the user leaves', async () => {
  vi.useFakeTimers();
  const data = { ...room, voice: { Host: { id: 'host-voice', connections: { 'host-voice': true } } } };
  const { result } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Guest', data, true, 'guest-uid'));
  await act(async () => result.current.join());
  for (let i = 0; i < 4; i++) await act(async () => { const peer = peers.at(-1); peer.connectionState = 'failed'; peer.onconnectionstatechange(); await vi.advanceTimersByTimeAsync(1000 * 2 ** i); });
  expect(peers).toHaveLength(5);
  expect(track.stop).not.toHaveBeenCalled();
  await act(async () => result.current.leave());
  const count = peers.length;
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(peers).toHaveLength(count);
});

it('keeps voice intent when the browser ends a microphone, without silently restarting capture', async () => {
  const { result } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Host', room, true, 'host-uid'));
  await act(async () => result.current.join());
  await act(async () => track.onended());
  expect(result.current.status).toBe('reconnecting');
  expect(result.current.needsMicrophone).toBe(true);
  expect(capture).toHaveBeenCalledOnce();
  await act(async () => result.current.leave());
  expect(result.current.status).toBe('off');
});
it('does not reopen capture after leaving while offline or replace another tab during reconnect', async () => {
  const { result, rerender } = renderHook(({ connected }) => useVoiceChat(database, 'ROOM_A', 'Host', room, connected, 'host-uid'), { initialProps: { connected: true } });
  await act(async () => result.current.join());
  await act(async () => rerender({ connected: false }));
  record = { id: 'another-tab', connections: { 'another-tab': true } };
  await act(async () => rerender({ connected: true }));
  expect(result.current.status).toBe('off');
  expect(record.id).toBe('another-tab');
  expect(track.stop).toHaveBeenCalledOnce();
  await act(async () => { rerender({ connected: false }); await result.current.leave(); });
  await act(async () => rerender({ connected: true }));
  expect(capture).toHaveBeenCalledOnce();
});
it('derives network feedback from measured RTP and candidate statistics', () => {
  const report = new Map([['pair', { type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.04 }],
    ['audio', { type: 'inbound-rtp', kind: 'audio', jitter: 0.01, packetsReceived: 100, packetsLost: 0 }]]);
  expect(summarizeVoiceStats([report])).toMatchObject({ quality: 'good', roundTripMs: 40, jitterMs: 10, packetLoss: 0 });
  report.get('audio').packetsLost = 20;
  expect(summarizeVoiceStats([report]).quality).toBe('unstable');
  expect(summarizeVoiceStats([]).quality).toBe('unknown');
});
it('rejects remote offers from absent users and from users who did not opt in', async () => {
  const { result } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Host', room, true, 'host-uid'));
  await act(async () => result.current.join());
  await act(async () => listeners.get('/rooms/ROOM_A/voiceSignals/offers/Host')({ val: () => ({
    Absent: { from: 'Absent', fromSession: 'remote', toSession: record.id, connectionId: 'connection', sdp: { type: 'offer', sdp: 'fixture' } },
  }) }));
  expect(peers).toHaveLength(0);
});
it('detects audio level and treats disconnected voice records as inactive', () => {
  expect(voiceLevel(new Uint8Array([128,128,128,128]))).toBe(0);
  expect(voiceLevel(new Uint8Array([0,255,0,255]))).toBeGreaterThan(0.9);
  expect(isVoiceActive({ id: 'old', connections: {} })).toBe(false);
});
it('stops capture on deletion or a secret mismatch of its own authorization grant', async () => {
  const { result } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Host', room, true, 'host-uid'));
  await act(async () => result.current.join());
  await act(async () => listeners.get('/roomAccess/ROOM_A/host-uid')?.({ val: () => null }));
  expect(track.stop).toHaveBeenCalledOnce();
  expect(result.current.status).toBe('off');
  await act(async () => result.current.join());
  expect(capture).toHaveBeenCalledOnce();
  await act(async () => listeners.get('/roomAccess/ROOM_A/host-uid')?.({ val: () => ({ name: 'Host', secret: 'revoked-secret' }) }));
  expect(result.current.status).toBe('off');
});
it('closes a revoked peer and rejects its stale signals even if it keeps advertising voice presence', async () => {
  const data = { ...room, voice: { Guest: { id: 'guest-voice', connections: { 'guest-voice': true } } } };
  const { result } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Host', data, true, 'host-uid'));
  await act(async () => result.current.join());
  const offer = { from: 'Guest', fromSession: 'guest-voice', toSession: record.id, connectionId: 'old-offer', sdp: { type: 'offer', sdp: 'fixture' } };
  await act(async () => listeners.get('/rooms/ROOM_A/voiceSignals/offers/Host')({ val: () => ({ Guest: offer }) }));
  expect(peers).toHaveLength(1);
  await act(async () => errors.get('/roomAccess/ROOM_A/guest-uid/name')?.({ code: 'PERMISSION_DENIED' }));
  expect(peers[0].close).toHaveBeenCalledOnce();
  expect(track.stop).not.toHaveBeenCalled();
  await act(async () => listeners.get('/rooms/ROOM_A/voiceSignals/offers/Host')({ val: () => ({ Guest: { ...offer, connectionId: 'malicious-retry' } }) }));
  expect(peers).toHaveLength(1);
});
it('treats authorization denial as terminal instead of retrying voice indefinitely', async () => {
  const { result } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Host', room, true, 'host-uid'));
  await act(async () => result.current.join());
  await act(async () => errors.get('/rooms/ROOM_A/voiceSignals/offers/Host')({ code: 'PERMISSION_DENIED' }));
  expect(track.stop).toHaveBeenCalledOnce();
  expect(result.current.status).toBe('off');
});

it('preserves ICE arriving before its matching voice offer and ignores old session ICE', async () => {
  const data = { ...room, voice: { Guest: { id: 'guest-voice', muted: false, speaking: false, connections: { 'guest-voice': true } } } };
  const { result } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Host', data, true, 'host-uid'));
  await act(async () => result.current.join());
  const entry = { from: 'Guest', fromSession: 'guest-voice', toSession: record.id, connectionId: 'voice-connection', ice: { candidate: 'current' } };
  await act(async () => listeners.get('/rooms/ROOM_A/voiceSignals/ice/Host')({ val: () => ({ Guest: { 0: entry, 1: { ...entry, fromSession: 'old', ice: { candidate: 'old' } } } }) }));
  await act(async () => listeners.get('/rooms/ROOM_A/voiceSignals/offers/Host')({ val: () => ({ Guest: { ...entry, sdp: { type: 'offer', sdp: 'fixture' } } }) }));
  expect(peers[0].receivedIce).toEqual([{ candidate: 'current' }]);
});

it('does not resend a pending voice request on unrelated room updates', async () => {
  const data = { ...room, voice: { Guest: { id: 'guest-voice', connections: { 'guest-voice': true } } } };
  const { result, rerender } = renderHook(({ data }) => useVoiceChat(database, 'ROOM_A', 'Host', data, true, 'host-uid'), { initialProps: { data } });
  await act(async () => result.current.join());
  for (let i = 0; i < 5; i++) await act(async () => rerender({ data: { ...data, updatedAt: i } }));
  expect(set.mock.calls.filter(([target]) => target.path.includes('/voiceSignals/requests/'))).toHaveLength(1);
});

it('publishes speaking transitions from local audio analysis and suppresses them while muted', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  let sample = 128;
  const close = vi.fn().mockResolvedValue();
  vi.stubGlobal('AudioContext', class {
    close = close;
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 512, getByteTimeDomainData: (values) => values.fill(sample) }; }
  });
  const { result, unmount } = renderHook(() => useVoiceChat(database, 'ROOM_A', 'Host', room, true, 'host-uid'));
  await act(async () => result.current.join());
  sample = 255;
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(record.speaking).toBe(true);
  sample = 128;
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(record.speaking).toBe(false);
  await act(async () => result.current.toggleMute());
  sample = 255;
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(record.speaking).toBe(false);
  unmount(); expect(close).toHaveBeenCalledOnce();
});
