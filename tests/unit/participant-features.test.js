import { afterEach, expect, it, vi } from 'vitest';
import { avatarFor, getTypingNames, createTypingPresence } from '../../src/presence/participantFeatures';
import { onDisconnect, ref, remove, set } from '../helpers/firebase-database';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('uses only known avatar presets and hides self, offline, expired and future typing records', () => {
  expect(avatarFor('Guest', { avatar: 'coral' })).toBe('coral');
  expect(['slate', 'sand', 'coral', 'forest']).toContain(avatarFor('Guest', { avatar: 'url(evil)' }));
  const records = { Guest: { tab: { updatedAt: 10000 } }, Host: { tab: { updatedAt: 10000 } },
    Old: { tab: { updatedAt: 1 } }, Future: { tab: { updatedAt: 30000 } }, Offline: { tab: { updatedAt: 10000 } } };
  expect(getTypingNames(records, ['Guest', 'Host', 'Old', 'Future'], 'Guest', 11000)).toEqual(['Host']);
});
it('arms disconnect cleanup before publishing, throttles updates and removes only its own connection', async () => {
  vi.useFakeTimers(); vi.setSystemTime(10000);
  ref.mockImplementation((_db, path) => ({ path }));
  const cleanup = { remove: vi.fn().mockResolvedValue(), cancel: vi.fn().mockResolvedValue() };
  onDisconnect.mockReturnValue(cleanup); set.mockResolvedValue(); remove.mockResolvedValue();
  const presence = createTypingPresence({}, 'A', 'Guest', 'own-tab');
  await presence.start(); await presence.start();
  expect(cleanup.remove).toHaveBeenCalledOnce(); expect(set).toHaveBeenCalledOnce();
  expect(set.mock.calls[0][0].path).toBe('/rooms/A/typing/Guest/own-tab');
  await presence.stop(); await presence.start(); expect(set).toHaveBeenCalledTimes(2);
  await presence.close();
  expect(remove).toHaveBeenCalledWith({ path: '/rooms/A/typing/Guest/own-tab' });
  expect(cleanup.cancel).toHaveBeenCalledOnce();
  await presence.start(); expect(set).toHaveBeenCalledTimes(2);
});
it('cleans up a late publication after teardown and never republishes it', async () => {
  let acknowledge; const write = new Promise(resolve => { acknowledge = resolve; });
  onDisconnect.mockReturnValue({ remove: vi.fn().mockResolvedValue(), cancel: vi.fn().mockResolvedValue() });
  set.mockReturnValue(write); remove.mockResolvedValue();
  const presence = createTypingPresence({}, 'A', 'Guest', 'late-tab');
  const pending = presence.start(); await Promise.resolve(); const closed = presence.close();
  acknowledge(); await pending; await closed;
  expect(remove).toHaveBeenCalledWith({ path: '/rooms/A/typing/Guest/late-tab' });
});
