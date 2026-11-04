import { expect, it, vi } from 'vitest';
import { normalizeMangaLibrary, updateMangaLibrary, createMangaLibrary } from '../../src/manga/library';
const id = '58be6aa6-06cb-4ca5-bd20-f1392ce451fb', chapterId = 'ff4f79de-6102-4610-8327-539904cfe549';
it('keeps saved status while recording page progress and never stores image URLs', () => {
  let items = updateMangaLibrary([], 'toggle', { id, title: 'Yotsuba' }, 1);
  items = updateMangaLibrary(items, 'record', { id, title: 'Yotsuba', chapterId, page: 3, imageUrl: 'never-store' }, 2);
  expect(items).toEqual([{ id, title: 'Yotsuba', chapterId, page: 3, saved: true, updatedAt: 2 }]);
  expect(updateMangaLibrary(items, 'toggle', { id, title: 'Yotsuba' }, 3)[0]).toMatchObject({ saved: false, page: 3 });
  expect(normalizeMangaLibrary([{ ...items[0], page: -1 }, { ...items[0], id: '../bad' }])).toEqual([]);
});
it('uses owner-scoped transactions and retains progress when removing a saved title', async () => {
  let current = [{ id, title: 'Yotsuba', chapterId, page: 3, saved: true, updatedAt: 2 }];
  const sdk = { ref: vi.fn((_db, path) => path), runTransaction: vi.fn(async (_ref, mutate) => { current = mutate(current); return { committed: true, snapshot: { val: () => current } }; }) };
  const service = createMangaLibrary({ db: {}, uid: 'account-a', sdk }); await service.remove(id);
  expect(sdk.ref).toHaveBeenCalledWith({}, 'accounts/account-a/mangaLibrary');
  expect(Object.values(current)[0]).toMatchObject({ id, page: 3, saved: false });
});
