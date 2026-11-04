import { useEffect, useRef, useState } from 'react';
import { onValue, ref } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { moderateRoomMember, unbanRoomMember } from '../auth/roomModeration';
import { validParticipantName } from '../auth/roomAccess';
export function useRoomModeration({ database, roomId, uid, isHost }) {
  const [state, setState] = useState({ scope: '', banned: [], pending: false, error: '' });
  const current = useRef(null);
  const scope = isHost && roomId && uid ? `${roomId}/${uid}` : '';
  const renderedScope = useRef(scope); renderedScope.current = scope;
  useEffect(() => {
    const session = { scope, active: true, pending: false }; current.current = session;
    setState({ scope, banned: [], pending: false, error: '' });
    if (!scope) return () => { session.active = false; };
    const unsubscribe = onValue(ref(database, `/roomBans/${roomId}`), snapshot => {
      if (!session.active || renderedScope.current !== scope) return;
      const banned = Object.entries(snapshot.val() || {}).filter(([id, value]) => /^[A-Za-z0-9_-]{1,128}$/.test(id) && validParticipantName(value?.name))
        .map(([id, value]) => ({ uid: id, name: value.name }));
      setState(previous => ({ ...previous, scope, banned }));
    }, () => { if (session.active) setState(previous => ({ ...previous, error: 'The ban list is unavailable. Please reconnect.' })); });
    return () => { session.active = false; unsubscribe?.(); };
  }, [database, roomId, uid, scope]);
  const run = async action => {
    const session = current.current;
    if (!scope || !session?.active || session.scope !== scope || renderedScope.current !== scope || session.pending) return;
    session.pending = true; setState(previous => ({ ...previous, pending: true, error: '' }));
    try { await action(); }
    catch { if (session.active) setState(previous => ({ ...previous, error: 'Room moderation could not finish. Refresh the room and try again.' })); }
    finally { session.pending = false; if (session.active) setState(previous => ({ ...previous, pending: false })); }
  };
  return { banned: state.scope === scope ? state.banned : [], pending: state.scope === scope && state.pending,
    error: state.scope === scope ? state.error : '',
    remove: (name, ban) => run(() => moderateRoomMember(database, uid, roomId, name, ban)),
    unban: id => run(() => unbanRoomMember(database, uid, roomId, id)) };
}
