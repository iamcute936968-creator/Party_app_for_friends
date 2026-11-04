import { useEffect, useState } from 'react';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

// Observe this client's Firebase transport only; never write room or playback state.
export function useRealtimeConnection(database, roomId) {
  const [connection, setConnection] = useState({ roomId: null, status: 'connecting' });

  useEffect(() => {
    if (!roomId) return;
    let active = true;
    let wasConnected = false;
    setConnection({ roomId, status: 'connecting' });

    const unsubscribe = onValue(ref(database, '.info/connected'), (snapshot) => {
      if (!active) return;
      const connected = snapshot.val() === true;
      const status = connected ? 'connected' : wasConnected ? 'reconnecting' : 'connecting';
      if (connected) wasConnected = true;
      setConnection({ roomId, status });
    }, () => {
      if (active) setConnection({ roomId, status: 'unavailable' });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [database, roomId]);

  return connection.roomId === roomId ? connection.status : 'connecting';
}
