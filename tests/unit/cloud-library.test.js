import { expect, it, vi } from 'vitest';
import { createCloudLibrary } from '../../src/library/cloudLibrary';

const media = { source: 'youtube', id: 'abcdefghijk', title: 'Movie' };
const entry = (extra = {}) => ({ ...media, position: 60, duration: 100, wishlist: false, updatedAt: 20, lastWatchedAt: 20, ...extra });
const stored = (remote, id) => Object.values(remote).find(item => item.id === id);
function setup(initial = {}) {
  let remote = initial, callback, errorCallback;
  const onItems = vi.fn(), onError = vi.fn(), unsubscribe = vi.fn();
  const sdk = {
    ref: vi.fn((_db, path) => ({ path })),
    onValue: vi.fn((_ref, success, failure) => { callback = success; errorCallback = failure; return unsubscribe; }),
    runTransaction: vi.fn(async (_ref, update) => { remote = update(remote); return { committed: true, snapshot: { val: () => remote } }; }),
  };
  const library = createCloudLibrary({ db: {}, uid: 'owner-uid', sdk, onItems, onError });
  return { library, sdk, onItems, onError, unsubscribe, get remote() { return remote; }, set remote(value) { remote = value; }, emit: value => callback({ val: () => value }), fail: error => errorCallback(error) };
}

it('subscribes only to the owner library and normalizes remote item maps', () => {
  const s = setup();
  s.library.subscribe();
  s.emit({ youtube_abcdefghijk: entry({ secret: 'private', email: 'private' }) });
  expect(s.sdk.ref).toHaveBeenCalledWith({}, 'accounts/owner-uid/library');
  expect(s.onItems).toHaveBeenCalledWith([expect.objectContaining({ id: media.id, position: 60 })]);
  s.emit([entry({ position: 75, secret: 'private' })]);
  expect(s.onItems).toHaveBeenLastCalledWith([expect.objectContaining({ id: media.id, position: 75 })]);
  expect(JSON.stringify(s.onItems.mock.calls)).not.toContain('private');
});

it.each(['', 'bad/uid', 'bad.uid', 'bad#uid', 'bad$uid', 'bad[uid', 'bad]uid', 'bad\nuid', 'bad\u007fuid', null, 'x'.repeat(129)])('rejects invalid account UID %j before any SDK call', uid => {
  const sdk = { ref: vi.fn(), onValue: vi.fn(), runTransaction: vi.fn() };
  expect(() => createCloudLibrary({ db: {}, uid, sdk, onItems: vi.fn() })).toThrow(/account/i);
  Object.values(sdk).forEach(fn => expect(fn).not.toHaveBeenCalled());
});

it('records against the latest remote values and retains concurrent updates from another device', async () => {
  const s = setup();
  s.library.subscribe(); s.emit({});
  s.remote = { drive_other: entry({ source: 'drive', id: 'other', position: 30 }) };
  await s.library.record({ ...media, position: 25, duration: 100, secret: 'private' });
  expect(s.sdk.runTransaction).toHaveBeenCalledOnce();
  expect(stored(s.remote, 'other').position).toBe(30);
  expect(stored(s.remote, media.id).position).toBe(25);
  expect(JSON.stringify(s.remote)).not.toContain('private');
});

it('toggles wishlist while preserving newer remote resume over a stale caller item', async () => {
  const s = setup({ youtube_abcdefghijk: entry({ position: 75, duration: 120 }) });
  await s.library.toggle({ ...entry({ position: 10, duration: 100 }), title: 'Wishlist title' });
  expect(stored(s.remote, media.id)).toMatchObject({ position: 75, duration: 120, wishlist: true, title: 'Wishlist title' });
  stored(s.remote, media.id).position = 80;
  await s.library.toggle(media);
  expect(stored(s.remote, media.id)).toMatchObject({ position: 80, wishlist: false });
});

it('writes canonical entries in sorted numeric slots 0..49 and removes raw private fields and invalid media', async () => {
  const s = setup();
  const guest = Array.from({ length: 60 }, (_, i) => entry({ source: 'drive', id: `file_${i}`, updatedAt: i, roomSecret: 'private', googleUser: { email: 'private' } }));
  await s.library.importGuest([...guest, { source: 'youtube', id: 'https://party.test/?secret=private' }]);
  expect(Object.keys(s.remote)).toHaveLength(50);
  expect(Object.keys(s.remote)).toEqual(Array.from({ length: 50 }, (_, index) => String(index)));
  expect(s.remote['0'].id).toBe('file_59');
  expect(s.remote['49'].id).toBe('file_10');
  expect(JSON.stringify(s.remote)).not.toMatch(/private|googleUser|roomSecret/);
});

it('imports only explicitly and keeps newer or equally recent remote entries', async () => {
  const s = setup({ youtube_abcdefghijk: entry({ position: 90, updatedAt: 40 }) });
  s.library.subscribe(); s.emit(s.remote);
  expect(s.sdk.runTransaction).not.toHaveBeenCalled();
  await s.library.importGuest([entry({ position: 10, updatedAt: 20 }), entry({ source: 'drive', id: 'guest_file', position: 15 })]);
  expect(stored(s.remote, media.id).position).toBe(90);
  expect(stored(s.remote, 'guest_file').position).toBe(15);
  await s.library.importGuest([entry({ position: 5, updatedAt: 40 })]);
  expect(stored(s.remote, media.id).position).toBe(90);
  await s.library.importGuest([entry({ position: 95, updatedAt: 50 })]);
  expect(stored(s.remote, media.id).position).toBe(95);
});

it('clears remote history while retaining reset wishlist items', async () => {
  const s = setup({ youtube_abcdefghijk: entry({ wishlist: true, completed: true }), drive_old: entry({ source: 'drive', id: 'old' }) });
  await s.library.clearHistory();
  expect(Object.keys(s.remote)).toEqual(['0']);
  expect(stored(s.remote, media.id)).toMatchObject({ wishlist: true, position: 0, duration: 0, completed: false, lastWatchedAt: 0 });
  await s.library.toggle(media);
  await s.library.clearHistory();
  expect(s.remote).toEqual({});
});

it('ignores late subscription values and errors after unsubscribing', () => {
  const s = setup();
  const stop = s.library.subscribe();
  stop(); s.emit({ youtube_abcdefghijk: entry() }); s.fail(new Error('private secret'));
  expect(s.unsubscribe).toHaveBeenCalledOnce();
  expect(s.onItems).not.toHaveBeenCalled();
  expect(s.onError).not.toHaveBeenCalled();
});

it('masks subscription and transaction errors without leaking provider details', async () => {
  const s = setup(); s.library.subscribe();
  const raw = Object.assign(new Error('private token detail'), { credential: 'private' });
  s.fail(raw);
  expect(s.onError).toHaveBeenCalledWith(expect.any(String));
  expect(JSON.stringify(s.onError.mock.calls)).not.toMatch(/private|token|detail/);
  s.sdk.runTransaction.mockRejectedValue(raw);
  const error = await s.library.record({ ...media, position: 1 }).catch(value => value);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).not.toMatch(/private|token|detail/);
  expect(error.cause).toBeUndefined();
  expect(s.onError).toHaveBeenCalledTimes(2);
});
