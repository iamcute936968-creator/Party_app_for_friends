import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMovieLibrary } from '../../src/hooks/useMovieLibrary';
import { onValue, runTransaction } from '../helpers/firebase-database';
const item = { kind: 'movie', id: '10378', title: 'Big Buck Bunny' };
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });
it('persists guest movie wishlist and progress independently of existing video libraries', async () => {
  localStorage.setItem('watchparty.viewing-library.v1', '["unchanged"]');
  const first = renderHook(() => useMovieLibrary()); await act(async () => first.result.current.toggle(item));
  await act(async () => first.result.current.record({ ...item, position: 12, duration: 300 })); first.unmount();
  const second = renderHook(() => useMovieLibrary()); expect(second.result.current.items[0]).toMatchObject({ wishlist: true, position: 12 });
  expect(localStorage.getItem('watchparty.viewing-library.v1')).toBe('["unchanged"]');
});
it('requires explicit guest import and ignores a previous account subscription after switching', async () => {
  const values = {}, observers = new Map();
  onValue.mockImplementation((target, next) => { observers.set(target.path, next); next({ val: () => values[target.path] || null }); return vi.fn(); });
  runTransaction.mockImplementation(async (target, update) => { values[target.path] = update(values[target.path]); observers.get(target.path)?.({ val: () => values[target.path] }); return { committed: true, snapshot: { val: () => values[target.path] } }; });
  const db = {}, view = renderHook(({ uid }) => useMovieLibrary({ db, accountUid: uid }), { initialProps: { uid: null } });
  await act(async () => view.result.current.toggle(item)); await act(async () => view.rerender({ uid: 'first' })); expect(view.result.current.items).toEqual([]);
  await act(async () => view.result.current.importGuest()); expect(view.result.current.items[0].id).toBe('10378');
  const stale = observers.get('accounts/first/movieLibrary'); await act(async () => view.rerender({ uid: 'second' }));
  act(() => stale({ val: () => values['accounts/first/movieLibrary'] })); expect(view.result.current.items).toEqual([]);
});
