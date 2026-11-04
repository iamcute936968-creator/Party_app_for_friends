import { useCallback, useEffect, useRef, useState } from 'react';
import { ref, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { LIBRARY_KEY, normalizeLibrary, recordViewing, toggleWishlist, removeViewing } from '../library/viewingLibrary';
import { createCloudLibrary } from '../library/cloudLibrary';
const sdk = { ref, onValue, runTransaction };
export function useViewingLibrary({ db, accountUid = null } = {}) {
  const [guestItems, setItems] = useState(() => {
    try { return normalizeLibrary(JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]')); } catch { return []; }
  });
  const [persistent, setPersistent] = useState(true);
  const [cloud, setCloud] = useState({ uid: null, items: [], status: 'idle', error: '' });
  const client = useRef(null);
  useEffect(() => {
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(guestItems)); }
    catch { setPersistent(false); }
  }, [guestItems]);
  useEffect(() => {
    if (!accountUid || !db) { client.current = null; return; }
    let active = true;
    setCloud({ uid: accountUid, items: [], status: 'syncing', error: '' });
    const service = createCloudLibrary({ db, uid: accountUid, sdk,
      onItems: items => { if (active) setCloud({ uid: accountUid, items, status: 'synced', error: '' }); },
      onError: error => { if (active) setCloud(previous => ({ ...previous, uid: accountUid, status: 'error', error })); } });
    client.current = { uid: accountUid, service };
    const unsubscribe = service.subscribe();
    return () => { active = false; unsubscribe(); if (client.current?.service === service) client.current = null; };
  }, [db, accountUid]);
  const mutate = useCallback((method, media, extra) => {
    if (!accountUid) return false;
    if (client.current?.uid === accountUid) return client.current.service[method](media, extra).catch(reason => { if (method === 'importGuest') throw reason; });
    if (method === 'importGuest') return Promise.reject(new Error('Your cloud library is unavailable. Please try again.'));
    return Promise.resolve();
  }, [accountUid]);
  const record = useCallback(media => accountUid ? mutate('record', media) : setItems(previous => recordViewing(previous, media)), [accountUid, mutate]);
  const toggle = useCallback(media => accountUid ? mutate('toggle', media) : setItems(previous => toggleWishlist(previous, media)), [accountUid, mutate]);
  const remove = useCallback((media, mode) => accountUid ? mutate('remove', media, mode) : setItems(previous => removeViewing(previous, media, mode)), [accountUid, mutate]);
  const clearHistory = useCallback(() => accountUid ? mutate('clearHistory') : setItems(previous => previous.filter(item => item.wishlist)
    .map(item => ({ ...item, position: 0, duration: 0, completed: false, lastWatchedAt: 0 }))), [accountUid, mutate]);
  const importGuest = useCallback(() => mutate('importGuest', guestItems), [guestItems, mutate]);
  return { items: accountUid ? cloud.uid === accountUid ? cloud.items : [] : guestItems,
    persistent, record, toggle, remove, clearHistory, importGuest, guestItemCount: guestItems.length,
    cloudStatus: accountUid ? cloud.uid === accountUid ? cloud.status : 'syncing' : 'guest',
    cloudError: accountUid && cloud.uid === accountUid ? cloud.error : '' };
}
