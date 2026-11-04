import { useCallback, useEffect, useRef, useState } from 'react';

export function useRoomEntry() {
  const session = useRef(null);
  const [state, setState] = useState({ action: null, error: '' });
  useEffect(() => {
    const current = { active: true, pending: false };
    session.current = current;
    return () => { current.active = false; if (session.current === current) session.current = null; };
  }, []);

  const run = useCallback(async (action, operation) => {
    const current = session.current;
    if (!current?.active || current.pending) return;
    current.pending = true;
    setState({ action, error: '' });
    let error = '';
    try { error = await operation() || ''; }
    catch { error = `Could not ${action} the room. Try again.`; }
    finally {
      current.pending = false;
      if (current.active) setState({ action: null, error });
    }
  }, []);
  const isPending = useCallback(() => Boolean(session.current?.pending), []);
  return { ...state, run, isPending };
}
