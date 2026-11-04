import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAnimeFavorites, useAnimeWishlist } from '../../src/hooks/useAnimeFavorites';
import { onValue, runTransaction } from '../helpers/firebase-database';

function Favorites() {
  const saved = useAnimeFavorites();
  return <><button onClick={() => saved.toggle({ id: '98444', title: 'Laid-Back Camp' })}>Save anime</button>
    <p>{saved.items.map(item => item.title).join(',')}</p></>;
}
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('combines the anime wishlist while retaining separate compatible guest storage', async () => {
  const { result } = renderHook(() => useAnimeWishlist());
  await act(async () => result.current.toggle({ id: 'ap_naruto', title: 'Naruto' }));
  await act(async () => result.current.toggle({ id: '98444', title: 'Laid-Back Camp' }));
  expect(result.current.items.map(item => item.title).sort()).toEqual(['Laid-Back Camp', 'Naruto']);
  expect(JSON.parse(localStorage.getItem('watchparty.paradise-favorites.v1'))[0].id).toBe('ap_naruto');
  expect(JSON.parse(localStorage.getItem('watchparty.anime-favorites.v1'))[0].id).toBe('98444');
});

it('isolates provider wishlist accounts and keeps legacy transactions out of the provider branch', async () => {
  const observers = new Map(), remote = {}, db = {};
  onValue.mockImplementation((target, next) => { observers.set(target.path, next); next({ val: () => remote[target.path] || null }); return vi.fn(); });
  runTransaction.mockImplementation(async (target, mutate) => {
    remote[target.path] = mutate(remote[target.path]); observers.get(target.path)?.({ val: () => remote[target.path] });
    return { committed: true, snapshot: { val: () => remote[target.path] } };
  });
  const { result, rerender } = renderHook(({ uid }) => useAnimeWishlist({ db, accountUid: uid }), { initialProps: { uid: 'account-a' } });
  await act(async () => result.current.toggle({ id: 'ap_naruto', title: 'Naruto' }));
  expect(Object.values(remote['accounts/account-a/paradiseFavorites'])[0].id).toBe('ap_naruto');
  expect(remote['accounts/account-a/animeFavorites']).toBeUndefined();
  const stale = observers.get('accounts/account-a/paradiseFavorites');
  await act(async () => rerender({ uid: 'account-b' }));
  act(() => stale({ val: () => remote['accounts/account-a/paradiseFavorites'] }));
  expect(result.current.items).toEqual([]);
});
it('guest title choices persist separately from playback entries and can be removed', async () => {
  localStorage.setItem('watchparty.viewing-library.v1', JSON.stringify([{ source: 'youtube', id: 'abcdefghijk' }]));
  const view = render(<Favorites />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save anime' })));
  expect(screen.getByText('Laid-Back Camp')).toBeTruthy(); view.unmount();
  render(<Favorites />); expect(screen.getByText('Laid-Back Camp')).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save anime' })));
  expect(screen.queryByText('Laid-Back Camp')).toBeNull();
  expect(JSON.parse(localStorage.getItem('watchparty.viewing-library.v1'))).toEqual([{ source: 'youtube', id: 'abcdefghijk' }]);
});

it('requires explicit guest import, isolates accounts and ignores old snapshots and mutation completions', async () => {
  const saved = { id: '98444', title: 'Laid-Back Camp', updatedAt: 20 }, observers = new Map(), remote = {};
  localStorage.setItem('watchparty.anime-favorites.v1', JSON.stringify([saved]));
  onValue.mockImplementation((target, next) => { observers.set(target.path, next); next({ val: () => remote[target.path] || null }); return vi.fn(); });
  runTransaction.mockImplementation(async (target, mutate) => {
    remote[target.path] = mutate(remote[target.path]);
    observers.get(target.path)?.({ val: () => remote[target.path] });
    return { committed: true, snapshot: { val: () => remote[target.path] } };
  });
  const db = {};
  const { result, rerender } = renderHook(({ uid }) => useAnimeFavorites({ db, accountUid: uid }), { initialProps: { uid: null } });
  expect(result.current.items).toEqual([saved]);
  await act(async () => rerender({ uid: 'account-a' }));
  expect(result.current.items).toEqual([]); expect(runTransaction).not.toHaveBeenCalled();
  await act(async () => result.current.importGuest());
  expect(result.current.items).toEqual([saved]);
  const stale = observers.get('accounts/account-a/animeFavorites');
  let release; runTransaction.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  let pending;
  act(() => { pending = result.current.toggle({ id: '12189', title: 'Hyouka' }); });
  await act(async () => rerender({ uid: 'account-b' }));
  await act(async () => { stale({ val: () => [saved] }); release({ committed: true, snapshot: { val: () => [saved] } }); await pending; });
  expect(result.current.items).toEqual([]);
  await act(async () => result.current.toggle({ id: '12189', title: 'Hyouka' }));
  expect(result.current.items[0].title).toBe('Hyouka');
  expect(Object.values(remote['accounts/account-a/animeFavorites'])).toEqual([saved]);
  await act(async () => rerender({ uid: null }));
  expect(result.current.items).toEqual([saved]);
  expect(JSON.parse(localStorage.getItem('watchparty.anime-favorites.v1'))).toEqual([saved]);
});

it('shows a session-only status when local storage rejects writes', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked'); });
  const { result } = renderHook(() => useAnimeFavorites());
  await act(async () => result.current.toggle({ id: '98444', title: 'Laid-Back Camp' }));
  expect(result.current.persistent).toBe(false);
  expect(result.current.items[0].title).toBe('Laid-Back Camp');
});

it('keeps a newer subscription update when an older transaction response arrives last', async () => {
  const camp = { id: '98444', title: 'Laid-Back Camp', updatedAt: 20 };
  const hyouka = { id: '12189', title: 'Hyouka', updatedAt: 30 };
  let next, release;
  onValue.mockImplementation((_target, callback) => { next = callback; callback({ val: () => null }); return vi.fn(); });
  runTransaction.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const db = {};
  const { result } = renderHook(() => useAnimeFavorites({ db, accountUid: 'account-a' }));
  let pending; act(() => { pending = result.current.toggle(camp); });
  act(() => next({ val: () => [hyouka, camp] }));
  await act(async () => { release({ committed: true, snapshot: { val: () => [camp] } }); await pending; });
  expect(result.current.items).toEqual([hyouka, camp]);
});
