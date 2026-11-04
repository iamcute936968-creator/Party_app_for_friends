import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { normalizeRoomShare } from '../../src/auth/roomAccess';
import { useWebRTC } from '../../src/hooks/useWebRTC';
import { ref, onValue, set, update, remove, get, runTransaction, onDisconnect } from '../helpers/firebase-database';

let room, listeners, capture, peers, errors;
const database = {};
const snapshot = (value) => ({ exists: () => value != null, val: () => value });
function stream() { const track = { stop: vi.fn(), applyConstraints: vi.fn() }; return { track, getTracks: () => [track], getVideoTracks: () => [track] }; }
beforeEach(() => {
  vi.clearAllMocks(); room = { id: 'ROOM_A', secret: 'fixture-secret', hostUid: 'Host', identities: { Host: 'Host', Guest: 'Guest', Other: 'Other' }, participants: { Host: true, Guest: true } }; listeners = new Map(); peers = []; errors = new Map();
  onDisconnect.mockReturnValue({ remove: vi.fn().mockResolvedValue(), cancel: vi.fn().mockResolvedValue() });
  ref.mockImplementation((_db, path) => ({ path }));
  onValue.mockImplementation((target, next, error) => {
    listeners.set(target.path, next); errors.set(target.path, error);
    const grant = /^\/roomAccess\/ROOM_A\/(Host|Guest|Other)(\/name)?$/.exec(target.path);
    if (grant) next(snapshot(grant[2] ? grant[1] : { name: grant[1], secret: room.secret }));
    return () => { listeners.delete(target.path); errors.delete(target.path); };
  });
  set.mockResolvedValue(); update.mockImplementation(async (_target, patch) => { room = normalizeRoomShare({ ...room, ...patch }); }); remove.mockResolvedValue(); get.mockResolvedValue(snapshot(room.participants));
  runTransaction.mockImplementation(async (target, fn) => { const share = target.path.endsWith('/screenShare'); const next = fn(share ? room.screenShare ?? null : null); if (next === undefined) return { committed: false }; if (share) room = normalizeRoomShare({ ...room, screenShare: next }); return { committed: true }; });
  capture = vi.fn(); vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: capture } });
  vi.stubGlobal('RTCPeerConnection', class {
    constructor() { peers.push(this); this.close = vi.fn(); this.addTrack = vi.fn(); this.createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'fixture' }); this.createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'fixture' }); this.setLocalDescription = vi.fn().mockResolvedValue(); this.setRemoteDescription = vi.fn().mockImplementation(async (sdp) => { this.remoteDescription = sdp; }); this.addIceCandidate = vi.fn().mockResolvedValue(); }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('keeps an established share through a brief network interruption and cancels delayed recovery on reconnect', async () => {
  vi.useFakeTimers();
  const media = stream(); capture.mockResolvedValue(media);
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  await act(async () => result.current.startShare());
  const peer = peers[0];
  act(() => { peer.connectionState = peer.iceConnectionState = 'connected'; peer.onconnectionstatechange(); });
  act(() => { peer.connectionState = peer.iceConnectionState = 'disconnected'; peer.onconnectionstatechange(); peer.oniceconnectionstatechange?.(); });
  expect(peer.close).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(7000));
  expect(peer.close).not.toHaveBeenCalled();
  act(() => { peer.connectionState = peer.iceConnectionState = 'connected'; peer.onconnectionstatechange(); });
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(peers).toHaveLength(1);
  expect(media.track.stop).not.toHaveBeenCalled();
  expect(result.current.shareError).toBe('');
});

it('retries a persistent disconnected peer after the recovery window without stopping screen capture', async () => {
  vi.useFakeTimers();
  const media = stream(); capture.mockResolvedValue(media);
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  await act(async () => result.current.startShare());
  const peer = peers[0];
  act(() => { peer.connectionState = peer.iceConnectionState = 'connected'; peer.onconnectionstatechange(); });
  act(() => { peer.connectionState = peer.iceConnectionState = 'disconnected'; peer.onconnectionstatechange(); });
  await act(async () => vi.advanceTimersByTimeAsync(7999));
  expect(peer.close).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(peer.close).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(peers).toHaveLength(2);
  expect(media.track.stop).not.toHaveBeenCalled();
});

it('closes a revoked peer immediately even during the network recovery window', async () => {
  vi.useFakeTimers(); capture.mockResolvedValue(stream());
  const { result, unmount } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  await act(async () => result.current.startShare());
  const peer = peers[0];
  act(() => { peer.connectionState = peer.iceConnectionState = 'connected'; peer.onconnectionstatechange(); });
  act(() => { peer.connectionState = peer.iceConnectionState = 'disconnected'; peer.onconnectionstatechange(); });
  await act(async () => listeners.get('/roomAccess/ROOM_A/Guest/name')(snapshot(null)));
  expect(peer.close).toHaveBeenCalledOnce();
  unmount();
  await act(async () => vi.advanceTimersByTimeAsync(20000));
  expect(peers).toHaveLength(1);
});

it('closes an established viewer when its grant is revoked without stopping the owner capture', async () => {
  const media = stream(); capture.mockResolvedValue(media);
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  await act(async () => result.current.startShare());
  const peer = peers[0];
  expect(typeof listeners.get('/roomAccess/ROOM_A/Guest/name')).toBe('function');
  await act(async () => listeners.get('/roomAccess/ROOM_A/Guest/name')(snapshot(null)));
  expect(peer.close).toHaveBeenCalledOnce();
  expect(media.track.stop).not.toHaveBeenCalled();
  const count = peers.length;
  await act(async () => listeners.get('/rooms/ROOM_A/webrtc/requests/Host')(snapshot({ Guest: { from: 'Guest', sessionId: room.shareSessionId, nonce: 'revoked' } })));
  expect(peers).toHaveLength(count);
});

it('stops capture on own grant denial and discards a capture that finishes after revocation', async () => {
  const media = stream(); let finish;
  capture.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  let pending; act(() => { pending = result.current.startShare(); });
  expect(typeof listeners.get('/roomAccess/ROOM_A/Host')).toBe('function');
  await act(async () => listeners.get('/roomAccess/ROOM_A/Host')(snapshot(null)));
  await act(async () => { finish(media); await pending; });
  expect(media.track.stop).toHaveBeenCalledOnce();
  expect(update).not.toHaveBeenCalled();
  expect(result.current.shareError).toMatch(/access/i);
});

it('fails closed on peer grant subscription errors and clears receiver playback', async () => {
  room = { ...room, isSharing: true, shareHost: 'Host', shareSessionId: 'broadcast' };
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Guest', false, room));
  await act(async () => listeners.get('/rooms/ROOM_A/webrtc/offers/Guest')(snapshot({ from: 'Host', sessionId: 'broadcast', connectionId: 'connection', sdp: { type: 'offer', sdp: 'fixture' } })));
  result.current.vidRef.current = { srcObject: { id: 'private-video' } };
  expect(typeof errors.get('/roomAccess/ROOM_A/Host/name')).toBe('function');
  await act(async () => errors.get('/roomAccess/ROOM_A/Host/name')({ code: 'PERMISSION_DENIED' }));
  expect(peers[0].close).toHaveBeenCalledOnce();
  expect(result.current.vidRef.current.srcObject).toBeNull();
});

it('rechecks a cancelled peer grant when the authorized viewer reconnects with the same identity', async () => {
  capture.mockResolvedValue(stream());
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  await act(async () => result.current.startShare());
  const grantPath = '/roomAccess/ROOM_A/Guest/name';
  await act(async () => errors.get(grantPath)({ code: 'PERMISSION_DENIED' }));
  listeners.delete(grantPath); errors.delete(grantPath);
  await act(async () => listeners.get('/rooms/ROOM_A/webrtc/requests/Host')(snapshot({ Guest: { from: 'Guest', sessionId: room.shareSessionId, nonce: 'rejoined' } })));
  expect(typeof listeners.get(grantPath)).toBe('function');
  expect(peers.length).toBeGreaterThan(1);
});

it('does not replay or republish requests for unchanged peer admission snapshots', async () => {
  room = { ...room, isSharing: true, shareHost: 'Host', shareSessionId: 'broadcast' };
  renderHook(() => useWebRTC(database, 'ROOM_A', 'Guest', false, room));
  await act(async () => {});
  const count = set.mock.calls.filter(([target]) => target.path.includes('/requests/')).length;
  await act(async () => { for (let i = 0; i < 5; i++) listeners.get('/roomAccess/ROOM_A/Host/name')(snapshot('Host')); });
  expect(set.mock.calls.filter(([target]) => target.path.includes('/requests/')).length).toBe(count);
});

it('ignores a rejected old offer after a replacement peer has negotiated', async () => {
  room = { ...room, isSharing: true, shareHost: 'Host', shareSessionId: 'broadcast' };
  let rejectOld;
  const Peer = RTCPeerConnection;
  vi.stubGlobal('RTCPeerConnection', class extends Peer {
    constructor(...args) { super(...args); if (peers.length === 1) this.setRemoteDescription.mockImplementation(() => new Promise((_, reject) => { rejectOld = reject; })); }
  });
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Guest', false, room));
  const receive = listeners.get('/rooms/ROOM_A/webrtc/offers/Guest');
  let pending;
  await act(async () => { pending = receive(snapshot({ from: 'Host', sessionId: 'broadcast', connectionId: 'old', sdp: { type: 'offer', sdp: 'old' } })); await Promise.resolve(); });
  await act(async () => result.current.reconnectShare());
  await act(async () => receive(snapshot({ from: 'Host', sessionId: 'broadcast', connectionId: 'new', sdp: { type: 'offer', sdp: 'new' } })));
  const replacement = peers[1];
  await act(async () => { rejectOld(new Error('late old failure')); await pending; });
  expect(replacement.close).not.toHaveBeenCalled();
});

it('awaits relay configuration and does not create late peers after sharing stops', async () => {
  capture.mockResolvedValue(stream());
  let finish;
  const configuration = { iceServers: [{ urls: 'turn:turn.cloudflare.com:3478', username: 'temporary', credential: 'temporary' }] };
  const getConfiguration = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room, true, 'Host', getConfiguration));
  let pending;
  await act(async () => { pending = result.current.startShare(); await Promise.resolve(); await Promise.resolve(); });
  expect(getConfiguration).toHaveBeenCalled();
  await act(async () => result.current.stopShare());
  await act(async () => { finish(configuration); await pending; });
  expect(peers).toHaveLength(0);
});

it('arms session-scoped disconnect cleanup before publishing and releases ownership on unmount', async () => {
  capture.mockResolvedValue(stream());
  const { result, unmount } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  await act(async () => result.current.startShare());
  const id = room.screenShare.id;
  expect(onDisconnect).toHaveBeenCalledWith({ path: `/rooms/ROOM_A/screenShare/connections/${id}` });
  expect(room.screenShare).toMatchObject({ version: 2, connections: { [id]: true } });
  expect(onDisconnect.mock.results[0].value.remove.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
  await act(async () => unmount());
  expect(room.isSharing).toBe(false);
});

it('does not publish when disconnect cleanup cannot be registered', async () => {
  const media = stream(); capture.mockResolvedValue(media);
  onDisconnect.mockReturnValue({ remove: vi.fn().mockRejectedValue(new Error('offline')), cancel: vi.fn().mockResolvedValue() });
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  await act(async () => result.current.startShare());
  expect(update).not.toHaveBeenCalled();
  expect(media.track.stop).toHaveBeenCalledOnce();
  expect(result.current.amSharing).toBe(false);
});

it('cancels late disconnect registration after leaving without publishing', async () => {
  let finish;
  const cancel = vi.fn().mockResolvedValue();
  onDisconnect.mockReturnValue({ remove: vi.fn(() => new Promise((resolve) => { finish = resolve; })), cancel });
  const media = stream(); capture.mockResolvedValue(media);
  const { result, unmount } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  let pending;
  await act(async () => { pending = result.current.startShare(); await Promise.resolve(); });
  unmount();
  await act(async () => { finish(); await pending; });
  expect(update).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalled();
  expect(media.track.stop).toHaveBeenCalledOnce();
});

it('requests capture synchronously, blocks duplicate starts and preserves video when permission is denied', async () => {
  let reject;
  capture.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  let pending;
  act(() => { pending = result.current.startShare(); void result.current.startShare(); });
  expect(capture).toHaveBeenCalledOnce();
  expect(update).not.toHaveBeenCalled();
  expect(runTransaction).not.toHaveBeenCalled();
  await act(async () => { reject(new DOMException('private detail', 'NotAllowedError')); await pending; });
  expect(result.current.shareError).toMatch(/permission|Allow/i);
  expect(result.current.shareError).not.toContain('private');
});
it('stops late capture after leaving without publishing or leaking tracks', async () => {
  let finish;
  const media = stream(); capture.mockImplementation(() => new Promise((done) => { finish = done; }));
  const { result, unmount } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  let pending; act(() => { pending = result.current.startShare(); });
  unmount();
  await act(async () => { finish(media); await pending; });
  expect(media.track.stop).toHaveBeenCalledOnce();
  expect(runTransaction).not.toHaveBeenCalled();
});
it('does not let a viewer stop another user broadcast', async () => {
  room = { ...room, isSharing: true, shareHost: 'Host', shareSessionId: 'other-broadcast' };
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Guest', false, room));
  await act(async () => result.current.stopShare());
  expect(runTransaction).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(room.isSharing).toBe(true);
});
it('offers explicit legacy owner recovery after reload without clearing a same-UID tab on unmount', async () => {
  room = normalizeRoomShare({ ...room, screenShare: { id: 'legacy', owner: 'Host', ownerUid: 'Host' } });
  const first = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  expect(first.result.current.canStopShare).toBe(true);
  await act(async () => first.unmount());
  expect(room.isSharing).toBe(true);
  const second = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  await act(async () => second.result.current.stopShare());
  expect(room.isSharing).toBe(false);
});
it('publishes capture atomically, handles browser Stop sharing, and only clears its own broadcast', async () => {
  const media = stream(); capture.mockResolvedValue(media);
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  await act(async () => result.current.startShare());
  expect(result.current.amSharing).toBe(true);
  expect(room).toMatchObject({ isSharing: true, shareHost: 'Host', playbackState: 'PAUSED', videoId: null });
  expect(typeof room.shareSessionId).toBe('string');
  await act(async () => media.track.onended());
  expect(media.track.stop).toHaveBeenCalledOnce();
  expect(room.isSharing).toBe(false);
  expect(result.current.amSharing).toBe(false);
});
it('does not clear a newer broadcast when an old owner stops', async () => {
  const media = stream(); capture.mockResolvedValue(media);
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  await act(async () => result.current.startShare());
  room = normalizeRoomShare({ ...room, screenShare: { owner: 'Guest', ownerUid: 'Guest', id: 'new-broadcast' } });
  await act(async () => result.current.stopShare());
  expect(room.shareHost).toBe('Guest');
  expect(room.isSharing).toBe(true);
});
it('lets the room host receive a member share, and writes answers per viewer', async () => {
  room = { ...room, isSharing: true, shareHost: 'Guest', shareSessionId: 'broadcast' };
  renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  const receive = listeners.get('/rooms/ROOM_A/webrtc/offers/Host');
  expect(receive).toBeTypeOf('function');
  await act(async () => receive(snapshot({ from: 'Guest', sessionId: 'broadcast', sdp: { type: 'offer', sdp: 'fixture' } })));
  expect(set).toHaveBeenCalledWith({ path: '/rooms/ROOM_A/webrtc/answers/Guest/Host' }, expect.objectContaining({ from: 'Host', sessionId: 'broadcast' }));
});
it('requests an active share on late join and on an explicit reconnect without claiming ownership', async () => {
  room = { ...room, isSharing: true, shareHost: 'Host', shareSessionId: 'broadcast' };
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Guest', false, room));
  expect(set).toHaveBeenCalledWith({ path: '/rooms/ROOM_A/webrtc/requests/Host/Guest' }, expect.objectContaining({ from: 'Guest', sessionId: 'broadcast' }));
  await act(async () => result.current.reconnectShare());
  expect(set.mock.calls.filter(([r]) => r.path.includes('/requests/')).length).toBe(2);
  expect(runTransaction).not.toHaveBeenCalled();
});
it('keeps concurrent viewer answers separate and handles both on a member-owned share', async () => {
  capture.mockResolvedValue(stream()); room.participants.Other = true;
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Guest', false, room));
  await act(async () => result.current.startShare());
  const receive = listeners.get('/rooms/ROOM_A/webrtc/answers/Guest');
  await act(async () => receive(snapshot({ Host: { from: 'Host', sessionId: room.shareSessionId, sdp: { type: 'answer', sdp: 'one' } }, Other: { from: 'Other', sessionId: room.shareSessionId, sdp: { type: 'answer', sdp: 'two' } } })));
  expect(peers.filter((p) => p.setRemoteDescription.mock.calls.length).length).toBe(2);
});

it('does not let an old stop acknowledgement remove ownership of a new capture', async () => {
  capture.mockImplementation(async () => stream());
  const { result, rerender } = renderHook(({ data }) => useWebRTC(database, 'ROOM_A', 'Host', true, data), { initialProps: { data: room } });
  await act(async () => result.current.startShare());
  let acknowledge;
  runTransaction.mockImplementationOnce(async (_target, fn) => {
    room = normalizeRoomShare({ ...room, screenShare: fn(room.screenShare) });
    await new Promise((resolve) => { acknowledge = resolve; });
    return { committed: true };
  });
  let stopping;
  act(() => { stopping = result.current.stopShare(); });
  rerender({ data: room });
  await act(async () => result.current.startShare());
  const newId = room.shareSessionId;
  await act(async () => { acknowledge(); await stopping; });
  await act(async () => result.current.stopShare());
  expect(newId).toBeTruthy();
  expect(room.isSharing).toBe(false);
});

it('processes an offer delivered before transport readiness once the viewer reconnects', async () => {
  room = { ...room, isSharing: true, shareHost: 'Host', shareSessionId: 'broadcast' };
  const { rerender } = renderHook(({ enabled }) => useWebRTC(database, 'ROOM_A', 'Guest', false, room, enabled), { initialProps: { enabled: false } });
  const receive = listeners.get('/rooms/ROOM_A/webrtc/offers/Guest');
  const offer = { from: 'Host', sessionId: 'broadcast', connectionId: 'connection', sdp: { type: 'offer', sdp: 'fixture' } };
  await act(async () => receive(snapshot(offer)));
  expect(peers).toHaveLength(0);
  rerender({ enabled: true });
  await act(async () => receive(snapshot(offer)));
  expect(set).toHaveBeenCalledWith({ path: '/rooms/ROOM_A/webrtc/answers/Host/Guest' }, expect.objectContaining({ connectionId: 'connection' }));
});

it('bounds unanswered viewer requests and offers a disconnected state instead of waiting forever', async () => {
  vi.useFakeTimers();
  room = { ...room, isSharing: true, shareHost: 'Host', shareSessionId: 'broadcast' };
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Guest', false, room));
  for (const delay of [10000, 1000, 10000, 2000, 10000, 4000, 10000]) await act(async () => vi.advanceTimersByTimeAsync(delay));
  expect(set.mock.calls.filter(([r]) => r.path.includes('/requests/'))).toHaveLength(4);
  expect(result.current.shareStatus).toBe('disconnected');
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(set.mock.calls.filter(([r]) => r.path.includes('/requests/'))).toHaveLength(4);
});

it('drains early ICE only for the current broadcast and connection', async () => {
  room = { ...room, isSharing: true, shareHost: 'Host', shareSessionId: 'broadcast' };
  renderHook(() => useWebRTC(database, 'ROOM_A', 'Guest', false, room));
  const ice = listeners.get('/rooms/ROOM_A/webrtc/ice/Guest');
  await act(async () => ice(snapshot({ Host: {
    oldBroadcast: { from: 'Host', sessionId: 'old', connectionId: 'current', ice: { candidate: 'old-broadcast' } },
    oldConnection: { from: 'Host', sessionId: 'broadcast', connectionId: 'old', ice: { candidate: 'old-connection' } },
    current: { from: 'Host', sessionId: 'broadcast', connectionId: 'current', ice: { candidate: 'current' } },
  } })));
  await act(async () => listeners.get('/rooms/ROOM_A/webrtc/offers/Guest')(snapshot({ from: 'Host', sessionId: 'broadcast', connectionId: 'current', sdp: { type: 'offer', sdp: 'fixture' } })));
  expect(peers[0].addIceCandidate).toHaveBeenCalledExactlyOnceWith({ candidate: 'current' });
});

it('rejects absent participant requests and does not churn a negotiating peer during request floods', async () => {
  capture.mockResolvedValue(stream());
  const { result } = renderHook(() => useWebRTC(database, 'ROOM_A', 'Host', true, room));
  await act(async () => result.current.startShare());
  const initialCount = peers.length;
  const receive = listeners.get('/rooms/ROOM_A/webrtc/requests/Host');
  await act(async () => receive(snapshot(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [
    `Absent${i}`, { from: `Absent${i}`, sessionId: room.shareSessionId, nonce: `probe${i}` },
  ])))));
  expect(peers).toHaveLength(initialCount);
  for (let i = 0; i < 20; i++) await act(async () => receive(snapshot({ Guest: { from: 'Guest', sessionId: room.shareSessionId, nonce: `burst${i}` } })));
  expect(peers).toHaveLength(initialCount);
});
