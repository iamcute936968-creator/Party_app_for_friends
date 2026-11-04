import { useCallback, useEffect, useRef, useState } from 'react';
import { buildRoomInvite } from '../invites/roomInvite';

export function useRoomInvite(roomId, secret, baseUrl) {
  const url = buildRoomInvite(baseUrl, roomId, secret);
  const session = useRef(null);
  const [state, setState] = useState({ url, status: 'idle', error: '' });
  useEffect(() => {
    const current = { url, active: true, pending: false, timer: null };
    session.current = current;
    setState({ url, status: 'idle', error: '' });
    return () => {
      current.active = false;
      clearTimeout(current.timer);
      if (session.current === current) session.current = null;
    };
  }, [url]);

  const send = useCallback(async (mode) => {
    const current = session.current;
    if (!current?.active || !current.url || current.pending) return;
    current.pending = true;
    clearTimeout(current.timer);
    const nativeShare = mode === 'share' && typeof navigator.share === 'function';
    setState({ url: current.url, status: nativeShare ? 'sharing' : 'copying', error: '' });
    try {
      // Keep the browser API call in the original click's user-activation context.
      if (nativeShare) await navigator.share({ title: 'Watch Party', url: current.url });
      else {
        if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(current.url);
      }
      if (!current.active) return;
      setState({ url: current.url, status: nativeShare ? 'shared' : 'copied', error: '' });
      current.timer = setTimeout(() => setState({ url: current.url, status: 'idle', error: '' }), 2000);
    } catch (error) {
      if (!current.active) return;
      if (nativeShare && error?.name === 'AbortError') setState({ url: current.url, status: 'idle', error: '' });
      else setState({ url: current.url, status: 'manual', error: `Could not ${nativeShare ? 'share' : 'copy'} the invite. Copy the link below.` });
    } finally { current.pending = false; }
  }, []);

  const copy = useCallback(() => send('copy'), [send]);
  const share = useCallback(() => send('share'), [send]);
  const visible = state.url === url;
  return { url, status: visible ? state.status : 'idle', error: visible ? state.error : '', copy, share };
}
