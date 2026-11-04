import { expect, it, vi } from 'vitest';
import { normalizeMovieLibrary, updateMovieLibrary, createMovieLibrary } from '../../src/movies/library';
const item = { kind: 'movie', id: '10378', title: 'Big Buck Bunny' };
it('keeps wishlist and real playback progress without storing player URLs', () => {
  let items = updateMovieLibrary([], 'toggle', item, 100);
  items = updateMovieLibrary(items, 'record', { ...item, position: 42, duration: 300, sourceUrl: 'https://private.example' }, 200);
  expect(items[0]).toMatchObject({ wishlist: true, position: 42, season: 0, episode: 0 }); expect(items[0]).not.toHaveProperty('sourceUrl');
  items = updateMovieLibrary(items, 'toggle', item, 300); expect(items[0]).toMatchObject({ wishlist: false, position: 42 });
  expect(normalizeMovieLibrary([{ ...items[0], position: -1 }])).toEqual([]);
});
it('separates movie and TV identities and rejects unbound episode progress', () => {
  const items = updateMovieLibrary(updateMovieLibrary([], 'toggle', item), 'toggle', { ...item, kind: 'tv' }); expect(items).toHaveLength(2);
  expect(() => updateMovieLibrary([], 'record', { ...item, kind: 'tv', position: 1, duration: 50 })).toThrow();
});
it('writes only the current owner movie library branch', async () => {
  let stored; const sdk = { ref: vi.fn((_db, path) => ({ path })), runTransaction: async (_ref, update) => { stored = update(stored); return { committed: true, snapshot: { val: () => stored } }; } };
  const service = createMovieLibrary({ db: {}, uid: 'owner', sdk }); await service.toggle(item);
  expect(sdk.ref).toHaveBeenCalledWith({}, 'accounts/owner/movieLibrary'); expect(stored['0'].wishlist).toBe(true);
});
it('removes watches from history and continue watching while preserving independent wishlist state', () => {
  let items = updateMovieLibrary([], 'toggle', item, 100);
  items = updateMovieLibrary(items, 'record', { ...item, position: 50, duration: 200 }, 200);
  expect(items[0]).toMatchObject({ wishlist: true, position: 50, lastWatchedAt: 200 });
  // Remove watch from history: watch state is cleared, item stays in wishlist
  const clearedWatch = updateMovieLibrary(items, 'remove', item, 300, { mode: 'History' });
  expect(clearedWatch[0]).toMatchObject({ wishlist: true, position: 0, duration: 0, lastWatchedAt: 0 });
  // Remove watch from item that had no wishlist: completely dropped
  const watchedOnly = updateMovieLibrary([], 'record', { ...item, position: 50, duration: 200 }, 200);
  expect(updateMovieLibrary(watchedOnly, 'remove', item, 300, { mode: 'History' })).toEqual([]);
  expect(updateMovieLibrary(watchedOnly, 'remove', item, 300, { mode: 'Continue watching' })).toEqual([]);
  // Remove from wishlist: wishlist false, watch history preserved
  const clearedWishlist = updateMovieLibrary(items, 'remove', item, 300, { mode: 'Wishlist' });
  expect(clearedWishlist[0]).toMatchObject({ wishlist: false, position: 50, lastWatchedAt: 200 });
  // Remove without mode or mode: all: removes both
  expect(updateMovieLibrary(items, 'remove', item, 300, { mode: 'all' })).toEqual([]);
  expect(updateMovieLibrary(items, 'remove', item, 300)).toEqual([]);
});
