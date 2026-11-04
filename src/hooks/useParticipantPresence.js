import { useCallback, useEffect, useRef, useState } from 'react';
import { createParticipantPresence } from '../presence/participantPresence';

export function useParticipantPresence(database, roomId, username) {
  const controller = useRef(null);
  const [state, setState] = useState({ roomId: null, ready: false, error: null });
  useEffect(() => {
    if (!roomId || !username) return;
    let active = true;
    setState({ roomId, ready: false, error: null });
    const presence = createParticipantPresence(database, roomId, username, (status) => {
      if (active) setState({ roomId, ...status, connectionId: status.ready ? presence.connectionId : null });
    });
    controller.current = presence;
    return () => {
      active = false;
      if (controller.current === presence) controller.current = null;
      void presence.leave().catch(() => undefined);
    };
  }, [database, roomId, username]);
  const leave = useCallback(() => controller.current?.leave() || Promise.resolve(false), []);
  return {
    ready: state.roomId === roomId && state.ready,
    error: state.roomId === roomId ? state.error : null,
    connectionId: state.roomId === roomId && state.ready ? state.connectionId : null,
    leave,
  };
}
