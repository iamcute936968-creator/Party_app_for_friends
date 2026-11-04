import { ref, set, remove, onDisconnect, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
export const AVATARS = ['slate', 'sand', 'coral', 'forest'];
export const AVATAR_KEY = 'watchparty.participant-profile.v1';
export function avatarFor(name = '', profile) {
  if (AVATARS.includes(profile?.avatar)) return profile.avatar;
  return AVATARS[Array.from(name).reduce((total, letter) => total + letter.codePointAt(0), 0) % AVATARS.length];
}
export function getTypingNames(records, onlineNames, self, now = Date.now()) {
  return onlineNames.filter(name => name !== self && Object.values(records?.[name] || {}).some(record =>
    Number.isFinite(record?.updatedAt) && now - record.updatedAt < 8000 && record.updatedAt <= now + 1000)).slice(0, 6);
}
// Each tab uses its existing participant connection key. No draft content leaves the device.
export function createTypingPresence(database, roomId, username, connectionId, onError = () => {}) {
  const node = ref(database, `/rooms/${roomId}/typing/${username}/${connectionId}`);
  const disconnect = onDisconnect(node);
  let armed, pending = Promise.resolve(), publishing = false, wanted = false, closed = false, closeTask;
  let lastWrite = -Infinity, epoch = 0;
  return {
    start() {
      if (closed) return Promise.resolve();
      wanted = true; ++epoch;
      if (publishing || Date.now() - lastWrite < 2000) return pending;
      publishing = true;
      pending = (async () => {
        armed ||= disconnect.remove(); await armed;
        if (closed || !wanted) return;
        lastWrite = Date.now(); await set(node, { updatedAt: serverTimestamp() });
        if (closed || !wanted) await remove(node);
      })().catch(() => { if (!closed) onError(); }).finally(() => { publishing = false; });
      return pending;
    },
    stop() {
      wanted = false; lastWrite = -Infinity; const run = ++epoch;
      return pending.then(() => { if (closed || run === epoch) return remove(node); }).catch(() => { if (!closed) onError(); });
    },
    close() {
      if (closeTask) return closeTask;
      closed = true; wanted = false; ++epoch;
      // Leave server cleanup armed when explicit cleanup cannot be acknowledged.
      closeTask = pending.then(() => remove(node)).then(() => disconnect.cancel()).catch(() => undefined);
      return closeTask;
    },
  };
}
