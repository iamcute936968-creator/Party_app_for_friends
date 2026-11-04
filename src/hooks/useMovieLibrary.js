import { useCallback, useEffect, useRef, useState } from 'react';
import { ref, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { createMovieLibrary, normalizeMovieLibrary, updateMovieLibrary } from '../movies/library';
const KEY = 'watchparty.movie-library.v1', sdk = { ref, onValue, runTransaction };
export function useMovieLibrary({ db, accountUid = null } = {}) {
  const [guest, setGuest] = useState(() => { try { return normalizeMovieLibrary(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; } });
  const [persistent, setPersistent] = useState(true), [cloud, setCloud] = useState({ uid: null, items: [], status: 'idle', error: '' });
  const client = useRef(null);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(guest)); } catch { setPersistent(false); } }, [guest]);
  useEffect(() => {
    if (!accountUid || !db) { client.current = null; return; }
    let active = true; setCloud({ uid: accountUid, items: [], status: 'syncing', error: '' });
    const service = createMovieLibrary({ db, uid: accountUid, sdk, onItems: items => { if (active) setCloud({ uid: accountUid, items, status: 'synced', error: '' }); },
      onError: error => { if (active) setCloud(old => ({ ...old, uid: accountUid, status: 'error', error })); } });
    const entry = { uid: accountUid, service }; client.current = entry; const stop = service.subscribe();
    return () => { active = false; stop(); if (client.current === entry) client.current = null; };
  }, [db, accountUid]);
  const mutate = useCallback(async (action, item, options) => {
    if (accountUid) { if (client.current?.uid !== accountUid) throw Error('Your movie library is not ready. Please try again.'); return client.current.service[action](item, options); }
    setGuest(current => updateMovieLibrary(current, action, item, Date.now(), options));
  }, [accountUid]);
  const toggle = useCallback(item => mutate('toggle', item), [mutate]), record = useCallback(item => mutate('record', item), [mutate]), remove = useCallback((item, options) => mutate('remove', item, options), [mutate]);
  const importGuest = useCallback(() => {
    if (!accountUid || client.current?.uid !== accountUid) return Promise.reject(Error('Sign in before importing your movie library.'));
    return client.current.service.importGuest(guest);
  }, [accountUid, guest]);
  return { items: accountUid ? cloud.uid === accountUid ? cloud.items : [] : guest, persistent,
    status: accountUid ? cloud.uid === accountUid ? cloud.status : 'syncing' : 'guest', error: accountUid && cloud.uid === accountUid ? cloud.error : '',
    toggle, record, remove, importGuest, guestItemCount: guest.length };
}
