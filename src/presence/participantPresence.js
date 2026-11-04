import { ref, push, set, remove, get, onValue, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

const ERROR = 'Could not update your presence. Rejoin the room to try again.';
const active = (value) => value === true || Boolean(value?.connections &&
  typeof value.connections === 'object' && Object.values(value.connections).some((online) => online === true));

export function getOnlineParticipants(participants) {
  return Object.entries(participants || {}).filter(([, value]) => active(value)).map(([name]) => name);
}

// Each connection owns exactly one child. Never delete or overwrite another tab's node.
// Legacy boolean participants remain readable; existing proxy/WebRTC readers retain username keys.
export function createParticipantPresence(database, roomId, username, onStatus) {
  const participantPath = `/rooms/${roomId}/participants/${username}`;
  const participant = ref(database, participantPath);
  const entries = new Set();
  let disposed = false;
  let generation = 0;
  let leaving;
  let activeConnectionId = null;
  const report = (ready, error = null) => { if (!disposed) onStatus({ ready, error }); };

  const retire = (entry) => {
    if (entry.cleanup) return entry.cleanup;
    entry.cleanup = (async () => {
      if (entry.write) await entry.write.catch(() => undefined);
      await remove(entry.node);
      // Keep server cleanup armed if the explicit removal was rejected.
      await entry.disconnect.cancel();
      entries.delete(entry);
    })().catch((error) => { entry.cleanup = null; throw error; });
    return entry.cleanup;
  };

  const unsubscribe = onValue(ref(database, '.info/connected'), async (snapshot) => {
    if (disposed) return;
    const attempt = ++generation;
    activeConnectionId = null;
    report(false);
    if (snapshot.val() !== true) return;
    // Old connection handlers may have executed while offline. Retire only our old keys.
    for (const entry of entries) void retire(entry).catch(() => report(false, ERROR));
    let entry;
    try {
      const node = push(ref(database, `${participantPath}/connections`));
      entry = { node, disconnect: onDisconnect(node), cleanup: null, write: null };
      entries.add(entry);
      await entry.disconnect.remove();
      if (disposed || generation !== attempt) { await retire(entry); return; }
      entry.write = set(node, true);
      await entry.write;
      if (disposed || generation !== attempt) { await retire(entry); return; }
      activeConnectionId = node.key;
      report(true);
    } catch {
      if (generation === attempt) report(false, ERROR);
      if (entry) await retire(entry).catch(() => report(false, ERROR));
    }
  }, () => { ++generation; report(false, ERROR); });

  return {
    get connectionId() { return activeConnectionId; },
    leave() {
      if (leaving) return leaving;
      disposed = true;
      activeConnectionId = null;
      ++generation;
      unsubscribe();
      leaving = Promise.all([...entries].map(retire))
        .then(() => get(participant))
        .then((snapshot) => !active(snapshot.val()));
      return leaving;
    },
  };
}
