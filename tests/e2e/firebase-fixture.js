// Served only by Playwright interception. No test sends requests to real Firebase.
const data = { rooms: { ROOM_A: {
  id: 'ROOM_A', roomName: 'Friday movie', host: 'Host', hostUid: 'fixture-host', secret: 'fixture-secret',
  identities: { Host: 'fixture-host', Guest: 'fixture-user' }, seats: { 0: { uid: 'fixture-host', name: 'Host' }, 1: { uid: 'fixture-user', name: 'Guest' } },
  participants: { Host: true }, messages: {}, videoId: null,
  playbackState: 'PAUSED', anchorTime: 0, updatedAt: 0,
} }, roomAccess: { ROOM_A: { 'fixture-user': { name: 'Guest', secret: 'fixture-secret' }, 'fixture-host': { name: 'Host', secret: 'fixture-secret' } } } };
const listeners = new Set();
const disconnects = new Map();
let connected = false;
let nextKey = 0;
let rejectNextMessage = false;
let rejectNextReaction = false;
let rejectNextRoomRead = false;
let rejectNextRoomCreate = false;
let pauseNextRoomRead = false;
let releaseRoomRead;
let rejectNextMedia = false;
let pauseNextMedia = false;
let releaseMedia;

const parts = (target) => target.path.split('/').filter(Boolean);
const snapshot = (value) => {
  const copy = structuredClone(value);
  return { val: () => copy, exists: () => copy != null };
};
const read = (target) => {
  if (target.path === '.info/connected') return connected;
  if (target.path === '.info/serverTimeOffset') return 0;
  return parts(target).reduce((value, key) => value?.[key], data) ?? null;
};
const notify = () => {
  for (const listener of [...listeners]) {
    if (!listener.target.path.startsWith('.info/')) listener.next(snapshot(read(listener.target)));
  }
};

export const getDatabase = () => ({});
export const ref = (_database, path) => ({ path });
export const get = async (target) => {
  if (parts(target).length === 2 && parts(target)[0] === 'rooms') {
    window.testRoomReadCount = (window.testRoomReadCount || 0) + 1;
    if (pauseNextRoomRead) {
      pauseNextRoomRead = false;
      await new Promise((done) => { releaseRoomRead = done; });
    }
    if (rejectNextRoomRead) {
      rejectNextRoomRead = false;
      throw new Error('private Firebase entry detail');
    }
  }
  return snapshot(read(target));
};
export const serverTimestamp = () => Date.now();
export const onDisconnect = (target) => ({
  remove: async () => { disconnects.set(target.path, () => remove(target)); },
  update: async (value) => { disconnects.set(target.path, () => update(target, value)); },
  cancel: async () => { disconnects.delete(target.path); },
});
export const onValue = (target, next, error) => {
  const listener = { target, next, error };
  listeners.add(listener);
  queueMicrotask(() => {
    if (listeners.has(listener)) next(snapshot(read(target)));
  });
  return () => listeners.delete(listener);
};
export const off = (target) => {
  for (const listener of listeners) if (listener.target.path === target.path) listeners.delete(listener);
};
export const set = async (target, value) => {
  if (rejectNextRoomCreate && parts(target).length === 2 && parts(target)[0] === 'rooms') {
    rejectNextRoomCreate = false;
    throw new Error('private Firebase create detail');
  }
  const keys = parts(target);
  const last = keys.pop();
  let parent = data;
  for (const key of keys) parent = parent[key] ??= {};
  if (value === null) delete parent[last];
  else parent[last] = value;
  notify();
};
export const update = async (target, value) => {
  if (Object.hasOwn(value, 'videoId')) {
    window.testMediaUpdateCount = (window.testMediaUpdateCount || 0) + 1;
    if (pauseNextMedia) {
      pauseNextMedia = false;
      await new Promise((done) => { releaseMedia = done; });
    }
    if (rejectNextMedia) {
      rejectNextMedia = false;
      throw new Error('private media update detail');
    }
  }
  const merged = structuredClone(read(target) || {});
  for (const [path, entry] of Object.entries(value)) {
    const keys = path.split('/');
    const last = keys.pop();
    let parent = merged;
    for (const key of keys) parent = parent[key] ??= {};
    if (entry === null) delete parent[last];
    else parent[last] = entry;
  }
  await set(target, merged);
};
export const remove = (target) => set(target, null);
export const runTransaction = async (target, operation) => {
  const value = operation(structuredClone(read(target)));
  if (value === undefined) return { committed: false, snapshot: snapshot(read(target)) };
  await set(target, value);
  return { committed: true, snapshot: snapshot(value) };
};
export const push = (target, value) => {
  if (rejectNextReaction && target.path.endsWith('/reactions')) {
    rejectNextReaction = false;
    return Promise.reject(new Error('private reaction provider detail'));
  }
  if (rejectNextMessage && value?.type === 'user') {
    rejectNextMessage = false;
    return Promise.reject(new Error('private database detail'));
  }
  const key = `key_${++nextKey}`;
  const child = { path: `${target.path}/${key}`, key };
  // Firebase push(ref) returns a reference synchronously; push(ref, value) is awaitable.
  if (value === undefined) return child;
  return set(child, value).then(() => child);
};

window.setTestConnection = async (value) => {
  connected = value;
  if (!value) {
    const handlers = [...disconnects.values()];
    disconnects.clear();
    await Promise.all(handlers.map((handler) => handler()));
  }
  for (const listener of [...listeners]) {
    if (listener.target.path === '.info/connected') listener.next(snapshot(value));
  }
};
window.failTestConnection = () => {
  for (const listener of listeners) {
    if (listener.target.path === '.info/connected') listener.error?.(new Error('private fixture error'));
  }
};
window.rejectNextTestMessage = () => { rejectNextMessage = true; };
window.rejectNextTestRoomRead = () => { rejectNextRoomRead = true; };
window.rejectNextTestRoomCreate = () => { rejectNextRoomCreate = true; };
window.pauseNextTestRoomRead = () => { pauseNextRoomRead = true; };
window.releaseTestRoomRead = () => releaseRoomRead?.();
window.seedTestAlternateRoom = () => {
  data.rooms.ROOM_B = { ...data.rooms.ROOM_A, id: 'ROOM_B', roomName: 'Another movie', secret: 'fixture-secret-b' };
};
window.rejectNextTestReaction = () => { rejectNextReaction = true; };
window.rejectNextTestMedia = () => { rejectNextMedia = true; };
window.pauseNextTestMedia = () => { pauseNextMedia = true; };
window.releaseTestMedia = () => releaseMedia?.();
window.seedTestDriveVideo = (roomId = 'ROOM_A', videoId = 'fixture-movie', videoSource = 'drive') => {
  Object.assign(data.rooms[roomId], { videoId, videoSource, playbackState: 'PLAYING', anchorTime: 37, updatedAt: Date.now() });
  notify();
};
window.testShareState = (roomId = 'ROOM_A') => {
  const room = data.rooms[roomId];
  return { isSharing: !!room.screenShare, shareHost: room.screenShare?.owner || null, shareSessionId: room.screenShare?.id || null };
};
window.seedTestScreenShare = () => {
  Object.assign(data.rooms.ROOM_A, { screenShare: { id: 'fixture-broadcast', owner: 'Host', ownerUid: 'fixture-host' }, videoId: null });
  notify();
};
window.deliverTestScreenOffer = (user = 'Guest') => set(ref(null, `/rooms/ROOM_A/webrtc/offers/${user}`), {
  from: 'Host', sessionId: 'fixture-broadcast', connectionId: crypto.randomUUID(), sdp: { type: 'offer', sdp: 'fixture-sdp' },
});
window.seedTestReactions = (roomId) => {
  data.rooms[roomId].reactions = {
    expired: { kind: 'love', user: 'Old reaction', timestamp: Date.now() - 6000 },
    future: { kind: 'love', user: 'Future reaction', timestamp: Date.now() + 60000 },
    malformed: { kind: 'like', user: { invalid: true }, timestamp: Date.now() },
  };
  notify();
};
window.addTestPeerReaction = (roomId, user = 'Taylor') => push(ref(null, `/rooms/${roomId}/reactions`), {
  kind: 'applause', user, timestamp: Date.now(),
});
window.testPlaybackState = (roomId) => {
  const room = data.rooms[roomId];
  return Object.fromEntries(['playbackState', 'anchorTime', 'updatedAt', 'videoId', 'isSharing'].map((key) => [key, key === 'isSharing' ? !!room.screenShare : room[key] ?? null]));
};
window.testRoomAnime = roomId => {
  const room = data.rooms[roomId];
  return { episode: room.animeEpisode, nonce: room.mediaSelectionId, playbackState: room.playbackState, anchorTime: room.anchorTime,
    privateUrlStored: JSON.stringify(room).includes('room-fixture') };
};
window.seedTestMessages = (roomId) => {
  data.rooms[roomId].messages = Object.fromEntries(Array.from({ length: 75 }, (_, index) => [
    `history_${String(index).padStart(3, '0')}`, { type: 'user', user: 'Peer', text: `History ${index}`, timestamp: index },
  ]));
  notify();
};

window.seedTestHostRecovery = () => {
  const room = data.rooms.ROOM_A;
  room.hostUid = 'fixture-user'; room.identities.Host = 'fixture-user'; delete room.identities.Guest;
  room.seats = { 0: { uid: 'fixture-user', name: 'Host' } };
  data.roomAccess.ROOM_A['fixture-user'] = { name: 'Host', secret: 'fixture-recovery-secret' };
};
window.seedTestVoice = (speaking = false) => {
  data.rooms.ROOM_A.voice ||= {};
  data.rooms.ROOM_A.voice.Host = { id: 'fixture-host-voice', muted: false, speaking, connections: { 'fixture-host-voice': true } };
  notify();
};
window.testVoiceState = () => structuredClone(data.rooms.ROOM_A.voice || {});
window.answerTestVoice = () => {
  const room = data.rooms.ROOM_A, offer = room.voiceSignals?.offers?.Host?.Guest;
  if (!offer) return false;
  void set(ref(null, '/rooms/ROOM_A/voiceSignals/answers/Guest/Host'), { from: 'Host', fromSession: room.voice.Host.id,
    toSession: room.voice.Guest.id, connectionId: offer.connectionId, sdp: { type: 'answer', sdp: 'fixture-answer' } });
  return true;
};
