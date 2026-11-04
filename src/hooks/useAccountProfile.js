import { useCallback, useEffect, useRef, useState } from 'react';
import { ref, onValue, set } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { normalizeAccountProfile, profileFromGoogle } from '../auth/accountProfile';

const LOAD_ERROR = 'Could not load your profile. Try again.';
const SAVE_ERROR = 'Could not save your profile. Try again.';
const SIGN_IN_ERROR = 'Sign in with Google to save your profile.';

export function useAccountProfile(db, user) {
  const uid = db && !user?.isAnonymous && typeof user?.uid === 'string' && user.uid ? user.uid : null;
  const session = useRef(null);
  const [state, setState] = useState({ uid: null, db: null, profile: null, status: 'idle', error: '' });

  useEffect(() => {
    if (!uid) return;
    const current = { uid, db, active: true, revision: 0, saving: false };
    session.current = current;
    setState({ uid, db, profile: null, status: 'loading', error: '' });
    let unsubscribe;
    const fail = () => {
      if (current.active) setState(previous => ({ ...previous, status: 'error', error: LOAD_ERROR }));
    };
    try {
      unsubscribe = onValue(ref(db, `accounts/${uid}/profile`), snapshot => {
        if (!current.active) return;
        try {
          const stored = snapshot.val();
          setState({ uid, db, profile: stored == null ? null : normalizeAccountProfile(stored),
            status: current.saving ? 'saving' : 'ready', error: '' });
        } catch { fail(); }
      }, fail);
    } catch { fail(); }
    return () => {
      current.active = false;
      if (session.current === current) session.current = null;
      unsubscribe?.();
    };
  }, [db, uid]);

  const saveProfile = useCallback(async value => {
    const current = session.current;
    if (!uid || !current?.active || current.uid !== uid || current.db !== db) throw new Error(SIGN_IN_ERROR);
    const profile = normalizeAccountProfile(value);
    const revision = ++current.revision;
    current.saving = true;
    const active = () => current.active && session.current === current && current.revision === revision;
    setState(previous => ({ ...previous, status: 'saving', error: '' }));
    try {
      await set(ref(db, `accounts/${uid}/profile`), profile);
      if (active()) setState({ uid, db, profile, status: 'saved', error: '' });
      return profile;
    } catch {
      if (active()) setState(previous => ({ ...previous, status: 'error', error: SAVE_ERROR }));
      throw new Error(SAVE_ERROR);
    } finally { if (active()) current.saving = false; }
  }, [db, uid]);

  const visible = uid && state.uid === uid && state.db === db;
  return {
    profile: uid ? (visible && state.profile !== null ? state.profile : profileFromGoogle(user)) : normalizeAccountProfile(null),
    saveProfile,
    status: uid ? (visible ? state.status : 'loading') : 'idle',
    error: visible ? state.error : '',
  };
}
