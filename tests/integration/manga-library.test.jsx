import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMangaLibrary } from '../../src/hooks/useMangaLibrary';
import { onValue, runTransaction } from '../helpers/firebase-database';
const id = '58be6aa6-06cb-4ca5-bd20-f1392ce451fb', chapterId = 'ff4f79de-6102-4610-8327-539904cfe549';
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });
it('persists guest bookmarks and reading position without writing to another library', async () => {
  localStorage.clear(); localStorage.setItem('watchparty.anime-favorites.v1', '["unchanged"]');
  const view = renderHook(() => useMangaLibrary());
  await act(async () => view.result.current.toggle({ id, title: 'Yotsuba' }));
  await act(async () => view.result.current.record({ id, title: 'Yotsuba', chapterId, page: 4 }));
  view.unmount(); const next = renderHook(() => useMangaLibrary());
  expect(next.result.current.items[0]).toMatchObject({ saved: true, page: 4, chapterId });
  expect(localStorage.getItem('watchparty.anime-favorites.v1')).toBe('["unchanged"]');
});
it('keeps account records isolated and never automatically imports guest reading history', async () => {
  localStorage.clear(); const observers = new Map(), values = {};
  onValue.mockImplementation((target, next) => { observers.set(target.path, next); next({ val: () => values[target.path] || null }); return vi.fn(); });
  runTransaction.mockImplementation(async (target, update) => { values[target.path] = update(values[target.path]); observers.get(target.path)?.({ val: () => values[target.path] }); return { committed: true, snapshot: { val: () => values[target.path] } }; });
  const db = {}, view = renderHook(({ uid }) => useMangaLibrary({ db, accountUid: uid }), { initialProps: { uid: null } });
  await act(async () => view.result.current.record({ id, title: 'Yotsuba', chapterId, page: 4 }));
  await act(async () => view.rerender({ uid: 'account-a' })); expect(view.result.current.items).toEqual([]);
  await act(async () => view.result.current.importGuest()); expect(view.result.current.items[0].page).toBe(4);
  const stale = observers.get('accounts/account-a/mangaLibrary');
  await act(async () => view.rerender({ uid: 'account-b' }));
  act(() => stale({ val: () => values['accounts/account-a/mangaLibrary'] })); expect(view.result.current.items).toEqual([]);
});
