import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ref, onValue, set, onDisconnect, runTransaction, remove } from '../helpers/firebase-database';
import { useVoiceChat } from '../../src/hooks/useVoiceChat';
import Room from '../../src/components/Room';
const db = {};
let data, observers, peers, tracks, audios, sequence;
const read = (path) => path.split('/').filter(Boolean).reduce((node, key) => node?.[key], data) ?? null;
const snap = (value) => ({ val: () => structuredClone(value) });
function Tab({ name }) {
  const [room, setRoom] = useState(null);
  useEffect(() => onValue(ref(db, '/rooms/ROOM_A'), (s) => setRoom(s.val())), []);
  const voice = useVoiceChat(db, 'ROOM_A', name, room, true, 'uid-'+name);
  return <section data-testid={name}><Room room={room} participants={['Host','Guest','Other']} connectionStatus="connected" voice={voice}
    messages={[]} floatMsgs={[]} vidRef={{ current: null }} driveVideoRef={{ current: null }} containerRef={{ current: null }} msgInput="" ytUrl="" vidSrc="youtube" /></section>;
}
const Tabs = ({ names }) => names.map((name) => <Tab key={name} name={name} />);
beforeEach(() => {
  vi.clearAllMocks(); observers = new Set(); peers = new Map(); tracks = []; audios = []; sequence = 0;
  data = { rooms: { ROOM_A: { id: 'ROOM_A', roomName: 'Movie night', host: 'Host', hostUid: 'uid-Host',
    secret: 'fixture-secret', identities: { Host: 'uid-Host', Guest: 'uid-Guest', Other: 'uid-Other' }, participants: { Host: true, Guest: true, Other: true } } },
    roomAccess: { ROOM_A: Object.fromEntries(['Host', 'Guest', 'Other'].map((name) => ['uid-'+name, { name, secret: 'fixture-secret' }])) } };
  ref.mockImplementation((_db, path) => ({ path }));
  onValue.mockImplementation((target, next) => { const entry = { path: target.path, next }; observers.add(entry); queueMicrotask(() => { if (observers.has(entry)) void next(snap(read(target.path))); }); return () => observers.delete(entry); });
  set.mockImplementation(async (target, value) => {
    const keys = target.path.split('/').filter(Boolean), last = keys.pop(); let parent = data;
    for (const key of keys) parent = parent[key] ??= {};
    if (value === null) delete parent[last]; else parent[last] = value;
    for (const entry of observers) queueMicrotask(() => { if (observers.has(entry)) void entry.next(snap(read(entry.path))); });
  });
  remove.mockImplementation((target) => set(target, null));
  runTransaction.mockImplementation(async (target, operation) => { const next = operation(structuredClone(read(target.path))); if (next === undefined) return { committed: false }; await set(target, next); return { committed: true }; });
  onDisconnect.mockReturnValue({ remove: vi.fn().mockResolvedValue(), cancel: vi.fn().mockResolvedValue() });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => { const track = { enabled: true, stop: vi.fn() }; tracks.push(track); return { getTracks: () => [track], getAudioTracks: () => [track] }; }) } });
  vi.stubGlobal('Audio', class { constructor() { this.play = vi.fn().mockResolvedValue(); this.pause = vi.fn(); audios.push(this); } });
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
        await this.ontrack?.({ streams: [other.stream] }); await other.ontrack?.({ streams: [this.stream] });
      }
    }
    async addIceCandidate() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('connects three opted-in voice users, receives remote audio, shares mute/speaking state and releases only the leaving user', async () => {
  const { rerender } = render(<Tabs names={['Host','Guest']} />, { reactStrictMode: true });
  await waitFor(() => expect(within(screen.getByTestId('Host')).getByRole('heading', { level: 1 }).textContent).toBe('Movie night'));
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  for (const name of ['Host','Guest']) await act(async () => fireEvent.click(within(screen.getByTestId(name)).getByRole('button', { name: 'Join voice' })));
  await waitFor(() => expect(audios.filter((audio) => audio.srcObject)).toHaveLength(2));
  const existingPeers = [...peers.values()], hostView = within(screen.getByTestId('Host'));
  fireEvent.click(hostView.getByRole('tab', { name: 'Chat', exact: true }));
  fireEvent.click(hostView.getByRole('tab', { name: 'Watch', exact: true }));
  expect([...peers.values()]).toEqual(existingPeers);
  expect(existingPeers.every(peer => peer.connectionState === 'connected')).toBe(true);
  for (const track of tracks) expect(track.stop).not.toHaveBeenCalled();
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  expect(audios.filter(audio => audio.srcObject)).toHaveLength(2);
  rerender(<Tabs names={['Host','Guest','Other']} />);
  await waitFor(() => expect(within(screen.getByTestId('Other')).getByRole('heading', { level: 1 }).textContent).toBe('Movie night'));
  await act(async () => fireEvent.click(within(screen.getByTestId('Other')).getByRole('button', { name: 'Join voice' })));
  await waitFor(() => expect(audios.filter((audio) => audio.srcObject)).toHaveLength(6));
  await act(async () => fireEvent.click(within(screen.getByTestId('Guest')).getByRole('button', { name: 'Mute microphone' })));
  expect(tracks[1].enabled).toBe(false);
  expect(data.rooms.ROOM_A.voice.Guest.muted).toBe(true);
  await act(async () => set(ref(db, '/rooms/ROOM_A/voice/Host'), { ...data.rooms.ROOM_A.voice.Host, speaking: true }));
  const otherView = within(screen.getByTestId('Other'));
  fireEvent.click(otherView.getByRole('button', { name: 'People (3)', exact: true }));
  const people = within(otherView.getByRole('dialog', { name: 'Room people' }));
  await waitFor(() => expect(people.getByRole('status', { name: 'Host speaking' })).toBeTruthy());
  fireEvent.click(people.getByRole('button', { name: 'Close people' }));
  await act(async () => fireEvent.click(within(screen.getByTestId('Guest')).getByRole('button', { name: 'Leave voice' })));
  expect(tracks[1].stop).toHaveBeenCalledOnce();
  expect(data.rooms.ROOM_A.voice.Guest).toBeUndefined();
  await waitFor(() => expect(audios.filter((audio) => audio.srcObject)).toHaveLength(2));
  rerender(<Tabs names={['Host']} />);
  await waitFor(() => expect(tracks[2].stop).toHaveBeenCalledOnce());
  expect(tracks[0].stop).not.toHaveBeenCalled();
  expect(data.rooms.ROOM_A.voice.Host).toBeTruthy();
});
it('an honest peer closes a revoked member even when that member ignores its own grant update', async () => {
  render(<Tabs names={['Host','Guest']} />);
  await waitFor(() => expect(within(screen.getByTestId('Host')).getByRole('heading', { level: 1 }).textContent).toBe('Movie night'));
  for (const name of ['Host','Guest']) await act(async () => fireEvent.click(within(screen.getByTestId(name)).getByRole('button', { name: 'Join voice' })));
  await waitFor(() => expect(audios.filter((audio) => audio.srcObject)).toHaveLength(2));
  // Simulate a modified revoked endpoint ignoring its local authorization listener.
  for (const observer of [...observers]) if (observer.path === '/roomAccess/ROOM_A/uid-Guest') observers.delete(observer);
  await act(async () => set(ref(db, '/roomAccess/ROOM_A/uid-Guest/name'), null));
  await waitFor(() => expect([...peers.values()].some((peer) => peer.connectionState === 'closed')).toBe(true));
  expect(tracks[0].stop).not.toHaveBeenCalled();
  expect(data.rooms.ROOM_A.voice.Guest).toBeTruthy();
});
