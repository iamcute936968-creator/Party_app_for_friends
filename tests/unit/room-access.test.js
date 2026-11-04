import { beforeEach, expect, it, vi } from 'vitest';
import { get, set, runTransaction } from '../helpers/firebase-database';
import { enrollRoom, validParticipantName, normalizeRoomShare } from '../../src/auth/roomAccess';

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ val: () => null });
  set.mockResolvedValue();
  runTransaction.mockResolvedValue({ committed: true });
});
it.each(['', 'bad/name', 'bad.name', 'bad#name', 'bad\nname', 'x'.repeat(41)])('rejects an unsafe participant key: %s', (name) => {
  expect(validParticipantName(name)).toBe(false);
});
it('requires an authenticated identity and full invite before first-time enrollment', async () => {
  await expect(enrollRoom({}, null, 'ROOM_A', 'Guest', 'secret')).rejects.toThrow(/sign in/i);
  await expect(enrollRoom({}, { uid: 'guest-uid' }, 'ROOM_A', 'Guest', '')).rejects.toThrow(/full invite/i);
  expect(set).not.toHaveBeenCalled();
});
it('enrolls before room reads, then reserves a UID-bound name', async () => {
  await enrollRoom({}, { uid: 'guest-uid' }, 'ROOM_A', 'Guest', 'invite-secret');
  expect(set).toHaveBeenCalledWith({ path: '/roomAccess/ROOM_A/guest-uid' }, { name: 'Guest', secret: 'invite-secret' });
  const [target, claim] = runTransaction.mock.calls.at(-1);
  expect(target.path).toBe('/rooms/ROOM_A/identities/Guest');
  expect(claim(null)).toBe('guest-uid');
  expect(claim('other-uid')).toBeUndefined();
});
it('permits code-only re-entry only with this UID existing grant and rejects a conflicting name', async () => {
  get.mockImplementation(async (target) => ({ val: () => target.path.startsWith('/roomAccess') ? { name: 'Guest', secret: 'saved-secret' } : target.path.includes('/identities/') ? 'guest-uid' : { 1: { uid: 'guest-uid', name: 'Guest' } } }));
  await expect(enrollRoom({}, { uid: 'guest-uid' }, 'ROOM_A', 'Other', '')).rejects.toThrow(/same name/i);
  await expect(enrollRoom({}, { uid: 'guest-uid' }, 'ROOM_A', 'Guest', '')).resolves.toBe('saved-secret');
});
it('rejects an occupied name before consuming a seat and permits changing an unclaimed name', async () => {
  get.mockImplementation(async (target) => ({ val: () => target.path.startsWith('/roomAccess') ? { name: 'Host', secret: 'saved-secret' } : target.path.endsWith('/Host') ? 'host-uid' : null }));
  await expect(enrollRoom({}, { uid: 'guest-uid' }, 'ROOM_A', 'Host', '')).rejects.toThrow(/already in use/);
  expect(runTransaction).not.toHaveBeenCalled();
  await expect(enrollRoom({}, { uid: 'guest-uid' }, 'ROOM_A', 'Guest', '')).resolves.toBe('saved-secret');
});
it('handles Firebase sparse seat arrays and idempotent claims from another tab', async () => {
  get.mockImplementation(async (target) => ({ val: () => target.path.endsWith('/seats') ? [{ uid: 'host-uid', name: 'Host' }, null, { uid: 'other-uid', name: 'Other' }] : null }));
  await expect(enrollRoom({}, { uid: 'guest-uid' }, 'ROOM_A', 'Guest', 'invite-secret')).resolves.toBe('invite-secret');
  const [target, claim] = runTransaction.mock.calls[0];
  expect(target.path).toBe('/rooms/ROOM_A/seats/1');
  expect(claim({ uid: 'guest-uid', name: 'Guest' })).toEqual({ uid: 'guest-uid', name: 'Guest' });
});
it('reuses its reserved seat after a race loses an unclaimed participant name', async () => {
  get.mockImplementation(async (target) => ({ val: () => target.path.startsWith('/roomAccess') ? { name: 'Host', secret: 'saved-secret' } :
    target.path.endsWith('/Host') ? 'host-uid' : target.path.endsWith('/seats') ? [{ uid: 'host-uid', name: 'Host' }, null, { uid: 'guest-uid', name: 'Host' }] : null }));
  await enrollRoom({}, { uid: 'guest-uid' }, 'ROOM_A', 'Guest', '');
  const [target, claim] = runTransaction.mock.calls[0];
  expect(target.path).toBe('/rooms/ROOM_A/seats/2');
  expect(claim({ uid: 'guest-uid', name: 'Host' })).toEqual({ uid: 'guest-uid', name: 'Guest' });
});
it('derives display state from the owner-bound screen node', () => {
  expect(normalizeRoomShare({ participants: { Guest: true }, screenShare: { id: 'broadcast', owner: 'Guest', ownerUid: 'guest-uid' } })).toMatchObject({ isSharing: true, shareHost: 'Guest', shareSessionId: 'broadcast' });
});
it('releases v2 shares when their exact marker disappears and preserves only online legacy owners', () => {
  const share = { version: 2, id: 'broadcast', owner: 'Guest', ownerUid: 'guest-uid' };
  expect(normalizeRoomShare({ screenShare: share }).isSharing).toBe(false);
  expect(normalizeRoomShare({ screenShare: { ...share, connections: { other: true } } }).isSharing).toBe(false);
  expect(normalizeRoomShare({ screenShare: { ...share, connections: { broadcast: true } } }).isSharing).toBe(true);
  expect(normalizeRoomShare({ screenShare: { id: 'legacy', owner: 'Guest' }, participants: { Guest: { connections: { tab: true } } } }).isSharing).toBe(true);
  expect(normalizeRoomShare({ screenShare: { id: 'legacy', owner: 'Guest' }, participants: {} }).isSharing).toBe(false);
});
