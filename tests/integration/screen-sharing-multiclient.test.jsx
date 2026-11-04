import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ref, onValue, set, update, remove, runTransaction, onDisconnect } from '../helpers/firebase-database';
import { normalizeRoomShare } from '../../src/auth/roomAccess';
import { useWebRTC } from '../../src/hooks/useWebRTC';
import Room from '../../src/components/Room';

const db = {};
let data, observers, peers, media, sequence, disconnects;
const read = (path) => path.split('/').filter(Boolean).reduce((node, key) => node?.[key], data) ?? null;
const snapshot = (value) => ({ val: () => structuredClone(value), exists: () => value != null });
const notify = () => { for (const entry of observers) queueMicrotask(() => { if (observers.has(entry)) void entry.next(snapshot(read(entry.path))); }); };
function Tab({ name }) {
  const [room, setRoom] = useState(null);
  useEffect(() => onValue(ref(db, '/rooms/ROOM_A'), (s) => setRoom(normalizeRoomShare(s.val()))), []);
  const share = useWebRTC(db, 'ROOM_A', name, name === 'Host', room);
  return <section data-testid={name}><Room room={room} isHost={name === 'Host'} participants={[]} messages={[]} floatMsgs={[]}
    vidRef={share.vidRef} driveVideoRef={{ current: null }} containerRef={{ current: null }} msgInput="" ytUrl="" vidSrc="youtube"
    startShare={share.startShare} stopShare={share.stopShare} reconnectShare={share.reconnectShare}
    shareStatus={share.shareStatus} shareError={share.shareError} amSharing={share.amSharing} /></section>;
}
function Tabs({ users }) { return users.map((name) => <Tab key={name} name={name} />); }
beforeEach(() => {
  vi.clearAllMocks(); observers = new Set(); peers = new Map(); sequence = 0;
  disconnects = new Map();
  onDisconnect.mockImplementation((target) => ({ remove: async () => { disconnects.set(target.path, () => remove(target)); }, cancel: async () => { disconnects.delete(target.path); } }));
  data = { roomAccess: { ROOM_A: Object.fromEntries(['Host', 'Guest', 'Other'].map(name => [name, { name, secret: 'fixture-secret' }])) },
    rooms: { ROOM_A: { id: 'ROOM_A', secret: 'fixture-secret', hostUid: 'Host', identities: { Host: 'Host', Guest: 'Guest', Other: 'Other' }, roomName: 'Movie night', host: 'Host', participants: { Guest: true } } } };
  const track = { stop: vi.fn() }; media = { getTracks: () => [track], getVideoTracks: () => [track] };
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue(media) } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  ref.mockImplementation((_db, path) => ({ path }));
  onValue.mockImplementation((target, next) => { const entry = { path: target.path, next }; observers.add(entry); queueMicrotask(() => { if (observers.has(entry)) void next(snapshot(read(target.path))); }); return () => observers.delete(entry); });
  set.mockImplementation(async (target, value) => {
    const keys = target.path.split('/').filter(Boolean); const last = keys.pop(); let parent = data;
    for (const key of keys) parent = parent[key] ??= {};
    if (value === null) delete parent[last]; else parent[last] = value;
    notify();
  });
  update.mockImplementation(async (target, patch) => set(target, { ...read(target.path), ...patch }));
  remove.mockImplementation((target) => set(target, null));
  runTransaction.mockImplementation(async (target, fn) => { const next = fn(structuredClone(read(target.path))); if (next === undefined) return { committed: false }; await set(target, next); return { committed: true }; });
  vi.stubGlobal('RTCPeerConnection', class {
    constructor() { this.id = String(++sequence); this.connectionState = 'new'; peers.set(this.id, this); }
    close() { this.connectionState = 'closed'; }
    addTrack(_track, stream) { this.stream = stream; }
    async createOffer() { return { type: 'offer', sdp: this.id }; }
    async createAnswer() { return { type: 'answer', sdp: this.id }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) {
      this.remoteDescription = value;
      if (value.type === 'answer') {
        const other = peers.get(value.sdp); this.connectionState = other.connectionState = 'connected';
        this.onconnectionstatechange?.(); other.onconnectionstatechange?.();
        await other.ontrack?.({ streams: [this.stream] });
      }
    }
    async addIceCandidate() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('allows a new owner after the old session disconnects and ignores delayed old-session cleanup', async () => {
  render(<Tabs users={['Guest']} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Share screen' })).toBeTruthy());
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share screen' })));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeTruthy());
  const oldId = data.rooms.ROOM_A.screenShare.id;
  const disconnect = disconnects.get(`/rooms/ROOM_A/screenShare/connections/${oldId}`);
  expect(disconnect).toBeTypeOf('function');
  await act(async () => disconnect());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Share screen' })).toBeTruthy());
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share screen' })));
  const newId = data.rooms.ROOM_A.screenShare.id;
  expect(newId).not.toBe(oldId);
  await act(async () => disconnect());
  expect(normalizeRoomShare(data.rooms.ROOM_A)).toMatchObject({ isSharing: true, shareSessionId: newId });
});

it('delivers a member-owned screen to two late viewers, reconnects one, and preserves the owner when another leaves', async () => {
  const { rerender } = render(<Tabs users={['Guest']} />, { reactStrictMode: true });
  await waitFor(() => expect(within(screen.getByTestId('Guest')).getByRole('heading', { level: 1 }).textContent).toBe('Movie night'));
  await act(async () => fireEvent.click(within(screen.getByTestId('Guest')).getByRole('button', { name: 'Share screen' })));
  await waitFor(() => expect(within(screen.getByTestId('Guest')).getByRole('button', { name: 'Stop sharing' })).toBeTruthy());
  await act(async () => set(ref(db, '/rooms/ROOM_A/participants'), { Guest: true, Host: true, Other: true }));
  rerender(<Tabs users={['Guest', 'Host', 'Other']} />);
  for (const name of ['Host', 'Other']) await waitFor(() => expect(within(screen.getByTestId(name)).getByRole('status', { name: 'Screen sharing status' }).textContent).toBe('Connected to screen share.'));
  const broadcast = data.rooms.ROOM_A.screenShare?.id;
  expect(within(screen.getByTestId('Host')).queryByRole('button', { name: 'Stop sharing' })).toBeNull();
  const hostViewer = [...peers.values()].find((pc) => pc.localDescription?.type === 'answer' && pc.connectionState === 'connected');
  const peerCount = peers.size;
  await act(async () => { hostViewer.connectionState = 'disconnected'; hostViewer.onconnectionstatechange(); });
  expect(hostViewer.connectionState).toBe('disconnected');
  expect(within(screen.getByTestId('Host')).getByLabelText('Viewing area').querySelector('video[autoplay]').srcObject).toBe(media);
  await act(async () => { hostViewer.connectionState = 'connected'; hostViewer.onconnectionstatechange(); });
  expect(peers.size).toBe(peerCount);
  expect(within(screen.getByTestId('Host')).getByRole('status', { name: 'Screen sharing status' }).textContent).toBe('Connected to screen share.');
  await act(async () => { hostViewer.connectionState = 'failed'; hostViewer.onconnectionstatechange(); });
  await act(async () => fireEvent.click(within(screen.getByTestId('Host')).getByRole('button', { name: 'Reconnect screen share' })));
  await waitFor(() => expect(within(screen.getByTestId('Host')).getByRole('status', { name: 'Screen sharing status' }).textContent).toBe('Connected to screen share.'));
  rerender(<Tabs users={['Guest', 'Other']} />);
  expect(data.rooms.ROOM_A.screenShare?.id).toBe(broadcast);
  expect(Boolean(data.rooms.ROOM_A.screenShare)).toBe(true);
  expect(media.getTracks()[0].stop).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(within(screen.getByTestId('Guest')).getByRole('button', { name: 'Stop sharing' })));
  expect(Boolean(data.rooms.ROOM_A.screenShare)).toBe(false);
  expect(media.getTracks()[0].stop).toHaveBeenCalledOnce();
});
