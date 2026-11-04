import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useViewingLibrary } from '../../src/hooks/useViewingLibrary';
import { LIBRARY_KEY } from '../../src/library/viewingLibrary';
import { onValue, runTransaction } from '../helpers/firebase-database';
const db = {};
const movie = { source: 'youtube', id: 'abcdefghijk', title: 'Guest movie', position: 40, duration: 100, updatedAt: 10, lastWatchedAt: 10 };
let observers, remote;
beforeEach(() => {
  localStorage.clear(); observers = new Map(); remote = {};
  onValue.mockImplementation((target, next) => { observers.set(target.path, next); next({ val: () => remote[target.path] || null }); return vi.fn(); });
  runTransaction.mockImplementation(async (target, mutate) => {
    remote[target.path] = mutate(remote[target.path]);
    observers.get(target.path)?.({ val: () => remote[target.path] });
    return { committed: true, snapshot: { val: () => remote[target.path] } };
  });
});
afterEach(cleanup);
it('isolates guest, Google accounts and stale snapshots without automatically uploading local history', async () => {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify([movie]));
  const { result, rerender } = renderHook(({ uid }) => useViewingLibrary({ db, accountUid: uid }), { initialProps: { uid: null } });
  expect(result.current.items[0].title).toBe('Guest movie');
  await act(async () => rerender({ uid: 'account-a' }));
  expect(result.current.items).toEqual([]);
  expect(runTransaction).not.toHaveBeenCalled();
  await act(async () => result.current.importGuest());
  expect(result.current.items[0].position).toBe(40);
  const stale = observers.get('accounts/account-a/library');
  await act(async () => rerender({ uid: 'account-b' }));
  await act(async () => stale({ val: () => ({ youtube_abcdefghijk: movie }) }));
  expect(result.current.items).toEqual([]);
  await act(async () => result.current.toggle({ ...movie, title: 'Account B movie' }));
  expect(result.current.items[0].title).toBe('Account B movie');
  expect(Object.values(remote['accounts/account-a/library'])[0].title).toBe('Guest movie');
  await act(async () => rerender({ uid: null }));
  expect(result.current.items[0].title).toBe('Guest movie');
  expect(JSON.parse(localStorage.getItem(LIBRARY_KEY))[0].title).toBe('Guest movie');
});
it('applies another device update and reports cloud errors without writing into the guest cache', async () => {
  const { result } = renderHook(() => useViewingLibrary({ db, accountUid: 'account-a' }));
  await act(async () => observers.get('accounts/account-a/library')({ val: () => ({ youtube_abcdefghijk: { ...movie, position: 80 } }) }));
  expect(result.current.items[0].position).toBe(80);
  runTransaction.mockRejectedValue(new Error('private-provider-detail'));
  await act(async () => result.current.record(movie));
  expect(result.current.cloudError).toMatch(/unavailable/i);
  expect(result.current.cloudError).not.toContain('private-provider-detail');
  expect(JSON.parse(localStorage.getItem(LIBRARY_KEY))).toEqual([]);
  await act(async () => { await expect(result.current.importGuest()).rejects.toThrow(/unavailable/i); });
});
