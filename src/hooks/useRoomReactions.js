import { useCallback, useEffect, useRef, useState } from 'react';
import { ref, push } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { getLiveReactions, REACTION_KINDS, REACTION_LIFETIME } from '../reactions/reactions';

const serverNow = (clock) => Date.now() + (Number.isFinite(clock?.current) ? clock.current : 0);

export function useRoomReactions(database, roomId, username, records, connected, clock = null, uid) {
  const session = useRef(null);
  const [feed, setFeed] = useState({ roomId, items: [] });
  const [sending, setSending] = useState({ roomId, username, busy: false, error: '' });

  useEffect(() => {
    const current = { roomId, username, active: true, busy: false, nextAllowedAt: 0, timer: null };
    session.current = current;
    setSending({ roomId, username, busy: false, error: '' });
    return () => {
      current.active = false;
      clearTimeout(current.timer);
      if (session.current === current) session.current = null;
    };
  }, [database, roomId, username]);

  useEffect(() => {
    let timer;
    const refresh = () => {
      const items = roomId ? getLiveReactions(records, serverNow(clock)) : [];
      setFeed({ roomId, items });
      if (items.length) timer = setTimeout(refresh,
        Math.max(1, items[0].timestamp + REACTION_LIFETIME - serverNow(clock)));
    };
    refresh();
    return () => clearTimeout(timer);
  }, [roomId, records, clock]);

  const send = useCallback(async (kind) => {
    const current = session.current;
    if (!current?.active || !current.roomId || !current.username?.trim() || !connected ||
      !REACTION_KINDS.includes(kind) || current.busy || Date.now() < current.nextAllowedAt) return;
    current.busy = true;
    current.nextAllowedAt = Date.now() + 1000;
    setSending({ roomId: current.roomId, username: current.username, busy: true, error: '' });
    let error = '';
    try {
      await push(ref(database, `/rooms/${current.roomId}/reactions`), {
        ...(uid ? { uid } : {}), kind, user: current.username.trim().slice(0, 40),
        // Send-time expiry prevents an offline queued write from replaying after reconnect.
        timestamp: serverNow(clock),
      });
    } catch {
      error = 'Reaction not sent. Try again.';
    }
    if (!current.active) return;
    setSending({ roomId: current.roomId, username: current.username, busy: true, error });
    current.timer = setTimeout(() => {
      current.busy = false;
      setSending({ roomId: current.roomId, username: current.username, busy: false, error });
    }, Math.max(0, current.nextAllowedAt - Date.now()));
  }, [database, connected, clock, uid]);

  const visible = sending.roomId === roomId && sending.username === username;
  return {
    reactions: feed.roomId === roomId ? feed.items : [], send,
    canSend: Boolean(roomId && username?.trim() && connected && visible && !sending.busy),
    error: visible ? sending.error : '',
  };
}
