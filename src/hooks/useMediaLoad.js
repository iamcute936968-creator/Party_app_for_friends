import { useCallback, useEffect, useRef, useState } from 'react';

const idle = { action: null, error: '', loaded: false };

export function useMediaLoad(roomId) {
  const session = useRef(null);
  const [state, setState] = useState(idle);
  useEffect(() => {
    const current = { roomId, active: true, pending: false };
    session.current = current;
    setState(idle);
    return () => { current.active = false; };
  }, [roomId]);

  const run = useCallback(async (action, operation) => {
    const current = session.current;
    if (!roomId || current?.roomId !== roomId || !current.active || current.pending) return false;
    current.pending = true;
    setState({ action, error: '', loaded: false });
    const isCurrent = () => current.active && session.current === current;
    let error = '', accepted = true;
    try { const result = await operation(isCurrent); accepted = result !== false; error = !accepted && action === 'load' ? 'Video selection was interrupted. Please try again.' : typeof result === 'string' ? result : ''; }
    catch {
      error = action === 'authorize' ? 'Could not authorize Google Drive. Try again.' :
        action === 'retry' ? 'Could not retry this video. Try again.' :
        'Could not add the video to the room. Try again.';
    } finally {
      current.pending = false;
      if (isCurrent()) setState({ action: null, error, loaded: action === 'load' && !error });
    }
    return isCurrent() && !error && accepted;
  }, [roomId]);

  return { ...state, run };
}
