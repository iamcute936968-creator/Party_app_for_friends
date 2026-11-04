import { useCallback, useEffect, useRef, useState } from 'react';
import { ref, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { createAnimeFavorites, normalizeAnimeFavorites, toggleAnimeFavorite } from '../anime/favorites';

const KEY = 'watchparty.anime-favorites.v1';
const sdk = { ref, onValue, runTransaction };
export function useAnimeFavorites({ db, accountUid = null, collection = 'animeFavorites' } = {}) {
  const key = collection === 'paradiseFavorites' ? 'watchparty.paradise-favorites.v1' : KEY;
  const [guestItems, setGuestItems] = useState(() => {
    try { return normalizeAnimeFavorites(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return []; }
  });
  const [persistent, setPersistent] = useState(true);
  const [cloud, setCloud] = useState({ uid: null, items: [], status: 'idle', error: '' });
  const client = useRef(null);
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(guestItems)); } catch { setPersistent(false); }
  }, [guestItems, key]);
  useEffect(() => {
    if (!accountUid || !db) { client.current = null; return; }
    let active = true;
    setCloud({ uid: accountUid, items: [], status: 'syncing', error: '' });
    const service = createAnimeFavorites({ db, uid: accountUid, sdk, collection,
      onItems: items => { if (active) setCloud({ uid: accountUid, items, status: 'synced', error: '' }); },
      onError: error => { if (active) setCloud(old => ({ ...old, uid: accountUid, status: 'error', error })); } });
    const entry = { uid: accountUid, service }; client.current = entry;
    const stop = service.subscribe();
    return () => { active = false; stop(); if (client.current === entry) client.current = null; };
  }, [db, accountUid, collection]);
  const mutate = useCallback(async (method, value) => {
    const entry = client.current;
    if (!accountUid || entry?.uid !== accountUid) throw new Error('Your saved anime are not ready. Please try again.');
    // onValue owns the visible list: a delayed transaction response may be older
    // than a snapshot already received from another device.
    return entry.service[method](value);
  }, [accountUid]);
  const toggle = useCallback(async item => {
    if (accountUid) return mutate('toggle', item);
    setGuestItems(current => toggleAnimeFavorite(current, item));
  }, [accountUid, mutate]);
  const importGuest = useCallback(() => mutate('importGuest', guestItems), [guestItems, mutate]);
  const remove = useCallback(async id => {
    if (accountUid) return mutate('remove', id);
    setGuestItems(current => current.filter(item => item.id !== id));
  }, [accountUid, mutate]);
  return { items: accountUid ? cloud.uid === accountUid ? cloud.items : [] : guestItems,
    status: accountUid ? cloud.uid === accountUid ? cloud.status : 'syncing' : 'guest',
    error: accountUid && cloud.uid === accountUid ? cloud.error : '', persistent, toggle, remove, importGuest,
    guestItemCount: guestItems.length };
}

export function useAnimeWishlist(options = {}) {
  const legacy = useAnimeFavorites(options);
  const paradise = useAnimeFavorites({ ...options, collection: 'paradiseFavorites' });
  const target = id => id?.startsWith('ap_') ? paradise : legacy;
  return { items: [...legacy.items, ...paradise.items].sort((a, b) => b.updatedAt - a.updatedAt),
    status: [legacy.status, paradise.status].includes('syncing') ? 'syncing' : legacy.status,
    error: legacy.error || paradise.error, persistent: legacy.persistent && paradise.persistent,
    toggle: item => target(item?.id).toggle(item), remove: id => target(id).remove(id),
    importGuest: () => Promise.all([legacy.importGuest(), paradise.importGuest()]), guestItemCount: legacy.guestItemCount + paradise.guestItemCount };
}
