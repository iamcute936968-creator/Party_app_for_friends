import { useCallback, useEffect, useRef, useState } from 'react';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SCRIPT_ID = '__gis_client_script__';
const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const AUTH_ERROR = 'Google Drive authorization could not finish. Please try again.';
const CANCELLED = 'Google Drive authorization was cancelled.';
const oauth = () => window.google?.accounts?.oauth2;

// Separate from legacy playback consent: never persist tokens or request drive.readonly.
export function useDriveUploadAuth({ accountUid, loginHint } = {}) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const [status, setStatus] = useState({ uid: null, ready: false, error: '' });
  const currentUid = useRef(accountUid);
  currentUid.current = accountUid;
  const mounted = useRef(false);
  const cached = useRef(null);
  const expiryTimer = useRef(null);
  const pending = useRef(null);

  const clearToken = useCallback(() => {
    cached.current = null;
    clearTimeout(expiryTimer.current); expiryTimer.current = null;
    pending.current?.finish(null, CANCELLED);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearToken(); };
  }, [clearToken]);

  useEffect(() => {
    clearToken();
    let active = true, interval, timeout, script;
    const stop = () => {
      clearInterval(interval); clearTimeout(timeout);
      script?.removeEventListener('load', loaded);
      script?.removeEventListener('error', failed);
    };
    const update = (ready, error = '') => {
      stop();
      if (active) setStatus({ uid: accountUid, ready, error });
    };
    const loaded = () => {
      if (typeof oauth()?.initTokenClient === 'function') update(true);
    };
    const failed = () => update(false, 'Google Drive authorization is unavailable. Please reload to try again.');
    setStatus({ uid: accountUid, ready: false, error: '' });
    if (accountUid && clientId) {
      if (typeof oauth()?.initTokenClient === 'function') loaded();
      else {
        script = document.getElementById(SCRIPT_ID);
        if (!script) {
          script = document.createElement('script');
          script.id = SCRIPT_ID; script.src = SCRIPT_URL; script.async = true; script.defer = true;
        }
        script.addEventListener('load', loaded); script.addEventListener('error', failed);
        interval = setInterval(loaded, 100); timeout = setTimeout(failed, 15_000);
        if (!script.isConnected) document.head.appendChild(script);
      }
    }
    return () => { active = false; stop(); clearToken(); };
  }, [accountUid, clientId, clearToken]);

  // This function stays synchronous until GIS opens its popup, preserving the gesture.
  const authorize = () => {
    const uid = accountUid;
    const reject = message => Promise.reject(new Error(message));
    if (!uid || !mounted.current || currentUid.current !== uid) return reject('Sign in to your account before authorizing Google Drive.');
    if (!clientId) return reject('Google Drive authorization is unavailable.');
    if (status.uid !== uid || !status.ready || typeof oauth()?.initTokenClient !== 'function') return reject('Google Drive authorization is still loading. Please try again.');
    if (cached.current?.uid === uid && cached.current.expiresAt > Date.now()) return Promise.resolve(cached.current.token);
    if (pending.current?.uid === uid) return pending.current.promise;
    clearToken();
    setStatus(previous => ({ ...previous, error: '' }));
    let resolve, fail, timer;
    const promise = new Promise((accept, decline) => { resolve = accept; fail = decline; });
    const attempt = { uid, promise, finish: (value, error) => {
      if (pending.current !== attempt) return;
      clearTimeout(timer); pending.current = null;
      if (!mounted.current || currentUid.current !== uid) { fail(new Error(CANCELLED)); return; }
      if (error) {
        setStatus(previous => ({ ...previous, error })); fail(new Error(error)); return;
      }
      const expiry = value?.expires_in;
      if (!value || value.error || typeof value.access_token !== 'string' ||
        !/^[\x21-\x7e]{1,8192}$/.test(value.access_token) || typeof value.scope !== 'string' ||
        value.scope.length > 8192 || !value.scope.split(/\s+/).includes(SCOPE) ||
        typeof expiry !== 'number' || !Number.isFinite(expiry) || expiry <= 0 || expiry > 86400) {
        setStatus(previous => ({ ...previous, error: AUTH_ERROR })); fail(new Error(AUTH_ERROR)); return;
      }
      const lifetime = expiry * 1000;
      // Retire before Google's deadline so a click never starts with an almost-expired token.
      const validFor = lifetime - Math.min(30_000, lifetime / 10);
      cached.current = { uid, token: value.access_token, expiresAt: Date.now() + validFor };
      expiryTimer.current = setTimeout(() => { cached.current = null; expiryTimer.current = null; }, validFor);
      resolve(value.access_token);
    } };
    pending.current = attempt;
    timer = setTimeout(() => attempt.finish(null, 'Google Drive authorization timed out. Please try again.'), 120_000);
    try {
      const client = oauth().initTokenClient({ client_id: clientId, scope: SCOPE, include_granted_scopes: false,
        ...(typeof loginHint === 'string' && loginHint.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(loginHint) ? { login_hint: loginHint } : {}),
        callback: value => attempt.finish(value), error_callback: () => attempt.finish(null, AUTH_ERROR) });
      client.requestAccessToken({ prompt: 'consent' });
    } catch { attempt.finish(null, AUTH_ERROR); }
    return promise;
  };

  return { ready: Boolean(accountUid && clientId && status.uid === accountUid && status.ready), authorize, clearToken,
    error: status.uid === accountUid ? status.error : '' };
}
