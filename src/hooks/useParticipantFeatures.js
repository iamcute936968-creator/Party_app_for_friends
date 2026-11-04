import { useCallback, useEffect, useRef, useState } from 'react';
import { ref, set } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { AVATARS, AVATAR_KEY, createTypingPresence } from '../presence/participantFeatures';
import { normalizeAccountProfile } from '../auth/accountProfile';
export function useParticipantFeatures(database, roomId, username, uid, connectionId, connected, sharedPhoto = '') {
  const photoURL = normalizeAccountProfile({ photoURL: sharedPhoto }).photoURL;
  const [avatar, setAvatar] = useState(() => {
    try { const value = JSON.parse(localStorage.getItem(AVATAR_KEY)); if (AVATARS.includes(value?.avatar)) return value.avatar; } catch { /* Optional preference. */ }
    return 'slate';
  });
  const [error, setError] = useState(''); const session = useRef(null);
  useEffect(() => {
    try { localStorage.setItem(AVATAR_KEY, JSON.stringify({ avatar })); }
    catch { setError('Avatar saved for this session only. Browser storage is unavailable.'); }
  }, [avatar]);
  useEffect(() => {
    if (!roomId || !username || !uid || !connected || !connectionId) return;
    let active = true;
    set(ref(database, `/rooms/${roomId}/profiles/${username}`), { avatar, ...(photoURL ? { photoURL } : {}) })
      .catch(() => { if (active) setError('Could not update your room avatar. Reconnect and try again.'); });
    return () => { active = false; };
  }, [database, roomId, username, uid, connected, connectionId, avatar, photoURL]);
  const stopTyping = useCallback(() => {
    const current = session.current; if (!current) return Promise.resolve();
    clearTimeout(current.timer); return current.presence.stop();
  }, []);
  useEffect(() => {
    if (!roomId || !username || !uid || !connectionId || !connected) return;
    const current = { timer: null, presence: createTypingPresence(database, roomId, username, connectionId,
      () => setError('Typing status is unavailable. Your messages can still be sent.')) };
    session.current = current;
    const blur = () => { void stopTyping(); };
    const hide = () => { if (document.visibilityState === 'hidden') blur(); };
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hide);
    return () => {
      clearTimeout(current.timer); if (session.current === current) session.current = null;
      void current.presence.close(); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hide);
    };
  }, [database, roomId, username, uid, connectionId, connected, stopTyping]);
  const typing = useCallback(value => {
    const current = session.current; if (!current) return;
    clearTimeout(current.timer);
    if (!value.trim() || document.visibilityState === 'hidden') { void current.presence.stop(); return; }
    void current.presence.start(); current.timer = setTimeout(() => { void current.presence.stop(); }, 5000);
  }, []);
  const chooseAvatar = useCallback(value => { if (AVATARS.includes(value)) { setError(''); setAvatar(value); } }, []);
  const leave = useCallback(() => {
    const current = session.current; if (!current) return Promise.resolve();
    clearTimeout(current.timer); session.current = null; return current.presence.close();
  }, []);
  return { avatar, chooseAvatar, typing, stopTyping, leave, error };
}
