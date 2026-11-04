import { useCallback, useEffect, useRef, useState } from 'react';
import { ref, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { createMangaLibrary, normalizeMangaLibrary, updateMangaLibrary } from '../manga/library';
const KEY = 'watchparty.manga-library.v1', sdk = { ref, onValue, runTransaction };
export function useMangaLibrary({ db, accountUid = null } = {}) {
  const [guest, setGuest] = useState(() => { try { return normalizeMangaLibrary(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; } });
  const [persistent, setPersistent] = useState(true), [cloud, setCloud] = useState({ uid: null, items: [], status: 'idle', error: '' });
  const client = useRef(null);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(guest)); } catch { setPersistent(false); } }, [guest]);
  useEffect(() => {
    if (!accountUid || !db) { client.current = null; return; }
    let active = true; setCloud({ uid: accountUid, items: [], status: 'syncing', error: '' });
    const service = createMangaLibrary({ db, uid: accountUid, sdk,
      onItems: items => { if (active) setCloud({ uid: accountUid, items, status: 'synced', error: '' }); },
      onError: error => { if (active) setCloud(old => ({ ...old, uid: accountUid, status: 'error', error })); } });
    const entry = { uid: accountUid, service }; client.current = entry; const stop = service.subscribe();
    return () => { active = false; stop(); if (client.current === entry) client.current = null; };
  }, [db, accountUid]);
  const mutate = useCallback(async (action, value) => {
    if (accountUid) {
      if (client.current?.uid !== accountUid) throw Error('Your manga library is not ready. Please try again.');
      return client.current.service[action](value);
    }
    setGuest(current => updateMangaLibrary(current, action === 'remove' ? 'remove' : action, action === 'remove' ? { id: value } : value));
  }, [accountUid]);
  const toggle = useCallback(item => mutate('toggle', item), [mutate]);
  const record = useCallback(item => mutate('record', item), [mutate]);
  const remove = useCallback(id => mutate('remove', id), [mutate]);
  const importGuest = useCallback(() => {
    if (!accountUid || client.current?.uid !== accountUid) return Promise.reject(Error('Sign in before importing your manga library.'));
    return client.current.service.importGuest(guest);
  }, [accountUid, guest]);
  return { items: accountUid ? cloud.uid === accountUid ? cloud.items : [] : guest, persistent,
    status: accountUid ? cloud.uid === accountUid ? cloud.status : 'syncing' : 'guest', error: accountUid && cloud.uid === accountUid ? cloud.error : '',
    toggle, record, remove, importGuest, guestItemCount: guest.length };
}
