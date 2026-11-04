import { expect, it, vi } from 'vitest';
import { normalizeAnimeFavorites, toggleAnimeFavorite, createAnimeFavorites } from '../../src/anime/favorites';

const item = (id = '98444', extra = {}) => ({ id, title: 'Laid-Back Camp', updatedAt: 20, ...extra });
it('normalizes bounded unique title IDs and excludes unknown fields', () => {
  const saved = normalizeAnimeFavorites([item('98444', { roomSecret: 'never-store', token: 'never-store' }), item('98444', { updatedAt: 30 }),
    item('../bad'), item('0'), item('2147483648'), item('1', { title: '' }), item('2', { updatedAt: Infinity })]);
  expect(saved).toEqual([item('98444', { updatedAt: 30 })]);
  expect(normalizeAnimeFavorites(Array.from({ length: 60 }, (_, index) => item(String(index + 1))))).toHaveLength(50);
});
it('toggles a saved title without changing the existing playback library shape', () => {
  const source = [item()];
  expect(toggleAnimeFavorite(source, item(), 40)).toEqual([]);
  expect(toggleAnimeFavorite([], { id: '12189', title: 'Hyouka' }, 40)).toEqual([{ id: '12189', title: 'Hyouka', updatedAt: 40 }]);
  expect(source).toEqual([item()]);
});

it('stores provider wishlist titles in a separate branch for compatibility with older clients', async () => {
  const sdk = { ref: vi.fn((_db, path) => path), runTransaction: vi.fn(async (_ref, update) => ({ committed: true, snapshot: { val: () => update(null) } })) };
  const service = createAnimeFavorites({ db: {}, uid: 'owner', sdk, collection: 'paradiseFavorites' });
  expect(await service.toggle({ id: 'ap_naruto', title: 'Naruto' }, 40)).toEqual([{ id: 'ap_naruto', title: 'Naruto', updatedAt: 40 }]);
  expect(sdk.ref).toHaveBeenCalledWith({}, 'accounts/owner/paradiseFavorites');
});
function setup() {
  let value = { 0: item() }, callback, failure;
  const sdk = { ref: vi.fn((_db, path) => path), onValue: vi.fn((_ref, next, fail) => { callback = next; failure = fail; return vi.fn(); }),
    runTransaction: vi.fn(async (_ref, update) => { value = update(value); return { committed: true, snapshot: { val: () => value } }; }) };
  const onItems = vi.fn(), onError = vi.fn();
  const service = createAnimeFavorites({ db: {}, uid: 'owner-uid', sdk, onItems, onError });
  return { service, sdk, onItems, onError, emit: data => callback({ val: () => data }), fail: error => failure(error), get value() { return value; } };
}
it('scopes transactions to the owner and merges with remote current state', async () => {
  const s = setup();
  await s.service.toggle({ id: '12189', title: 'Hyouka' }, 30);
  expect(s.sdk.ref).toHaveBeenCalledWith({}, 'accounts/owner-uid/animeFavorites');
  expect(Object.values(s.value).map(x => x.id)).toEqual(['12189', '98444']);
  expect(Object.keys(s.value)).toEqual(['0', '1']);
});
it('imports guest choices explicitly and keeps newer remote title data', async () => {
  const s = setup();
  await s.service.importGuest([item('98444', { updatedAt: 1, title: 'Older guest title' }), item('12189')]);
  expect(Object.values(s.value).find(x => x.id === '98444').title).toBe('Laid-Back Camp');
  expect(Object.values(s.value)).toHaveLength(2);
});

it('removes a title idempotently so repeated removal cannot add it again', async () => {
  const s = setup();
  await s.service.remove('98444'); await s.service.remove('98444');
  expect(s.value).toBeNull();
});
it('ignores late subscription callbacks and masks persistence errors', async () => {
  const s = setup(); const stop = s.service.subscribe(); s.emit({ 0: item() }); stop(); s.emit({ 0: item('12189') });
  expect(s.onItems).toHaveBeenCalledTimes(1);
  s.sdk.runTransaction.mockRejectedValue(new Error('private secret'));
  await expect(s.service.toggle(item())).rejects.toThrow('Your saved anime could not be updated.');
  expect(s.onError).toHaveBeenCalledWith('Your saved anime could not be updated.');
});
it('rejects invalid account selectors before creating a database reference', () => {
  const sdk = { ref: vi.fn() };
  for (const uid of ['', '../another', 'a'.repeat(129)]) expect(() => createAnimeFavorites({ db: {}, uid, sdk })).toThrow();
  expect(sdk.ref).not.toHaveBeenCalled();
});
