import { beforeEach, expect, it } from 'vitest';
import { get, update } from '../helpers/firebase-database';
import { moderateRoomMember, unbanRoomMember } from '../../src/auth/roomModeration';
const room = () => ({ id: 'ROOM_A', host: 'Host', hostUid: 'host-uid', identities: { Host: 'host-uid', Guest: 'guest-uid' },
  seats: { 0: { uid: 'host-uid', name: 'Host' }, 1: { uid: 'guest-uid', name: 'Guest' } },
  screenShare: { owner: 'Guest', ownerUid: 'guest-uid' } });
beforeEach(() => { get.mockResolvedValue({ val: room }); update.mockResolvedValue(); });
it('uses fresh room identity and atomically removes only the selected nonhost state', async () => {
  await moderateRoomMember({}, 'host-uid', 'ROOM_A', 'Guest', true);
  expect(get.mock.calls[0][0].path).toBe('/rooms/ROOM_A');
  expect(update).toHaveBeenCalledTimes(1);
  const patch = update.mock.calls[0][1];
  expect(patch).toMatchObject({ 'roomAccess/ROOM_A/guest-uid': null, 'rooms/ROOM_A/identities/Guest': null,
    'rooms/ROOM_A/seats/1': null, 'rooms/ROOM_A/participants/Guest': null, 'rooms/ROOM_A/voice/Guest': null,
    'rooms/ROOM_A/screenShare': null, 'roomBans/ROOM_A/guest-uid': { name: 'Guest', createdAt: 1000 } });
  expect(JSON.stringify(patch)).not.toContain('host-uid');
  expect(Object.keys(patch).some(key => key.includes('/Host'))).toBe(false);
});
it('keeps unrelated broadcasts and bans unchanged during a remove', async () => {
  get.mockResolvedValue({ val: () => ({ ...room(), screenShare: { owner: 'Host', ownerUid: 'host-uid' } }) });
  await moderateRoomMember({}, 'host-uid', 'ROOM_A', 'Guest', false);
  const patch = update.mock.calls[0][1];
  expect(patch['rooms/ROOM_A/screenShare']).toBeUndefined();
  expect(Object.keys(patch).some(key => key.startsWith('roomBans'))).toBe(false);
});
it.each([['guest-uid', 'Guest'], ['host-uid', 'Host'], ['host-uid', 'Unknown'], ['host-uid', '../Guest']])('rejects invalid moderation %s/%s', async (actor, name) => {
  await expect(moderateRoomMember({}, actor, 'ROOM_A', name, true)).rejects.toThrow(); expect(update).not.toHaveBeenCalled();
});
it('unbans a nonhost UID without restoring old grants or seats', async () => {
  await unbanRoomMember({}, 'host-uid', 'ROOM_A', 'guest-uid');
  expect(update.mock.calls[0][1]).toEqual({ 'roomBans/ROOM_A/guest-uid': null });
  await expect(unbanRoomMember({}, 'guest-uid', 'ROOM_A', 'host-uid')).rejects.toThrow();
});
