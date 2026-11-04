import { ref, get, set, runTransaction } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { getOnlineParticipants } from '../presence/participantPresence';

export const validParticipantName = (name) => typeof name === 'string' && name === name.trim() &&
  name.length > 0 && name.length <= 40 && name.split('').every((char) => !'.#$[]/'.includes(char) && char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127);
const accessError = (message) => Object.assign(new Error(message), { code: 'room-access' });

export async function enrollRoom(database, user, roomId, name, inviteSecret) {
  if (!user?.uid) throw accessError('Please sign in before entering a room.');
  if (!validParticipantName(name)) throw accessError('Use a name of 1–40 characters without . # $ [ ] or /.');
  const grantRef = ref(database, `/roomAccess/${roomId}/${user.uid}`);
  const existing = (await get(grantRef)).val();
  if (existing?.name && existing.name !== name && (await get(ref(database, `/rooms/${roomId}/identities/${existing.name}`))).val() === user.uid) {
    throw accessError('Use the same name you previously used in this room.');
  }
  const secret = inviteSecret || existing?.secret;
  if (!secret) throw accessError('Use the full invite link to join this private room.');
  await set(grantRef, { name, secret });
  const identity = ref(database, `/rooms/${roomId}/identities/${name}`);
  const occupant = (await get(identity)).val();
  if (occupant && occupant !== user.uid) throw accessError('That name is already in use. Choose another name.');
  const seats = (await get(ref(database, `/rooms/${roomId}/seats`))).val() || {};
  // ponytail: Six identities remain reserved for safe re-entry; create a new room to rotate the guest list.
  const owned = Object.entries(seats).find(([, seat]) => seat?.uid === user.uid);
  let seated = false;
  for (const slot of owned ? [owned[0]] : [0, 1, 2, 3, 4, 5]) {
    if (!owned && seats[slot]) continue;
    const result = await runTransaction(ref(database, `/rooms/${roomId}/seats/${slot}`),
      (current) => current === null || current?.uid === user.uid ? { uid: user.uid, name } : undefined);
    if (result.committed) { seated = true; break; }
  }
  if (!seated) throw accessError('This room has reached its six-person limit.');
  const claim = await runTransaction(identity,
    (current) => current === null || current === user.uid ? user.uid : undefined);
  if (!claim.committed) throw accessError('That name is already in use. Choose another name.');
  return secret;
}

export function normalizeRoomShare(room) {
  if (!room) return room;
  if (!room.hostUid && !Object.hasOwn(room, 'screenShare')) return room;
  const share = room.screenShare;
  const active = Boolean(share && (share.version === 2 ? share.connections?.[share.id] === true : getOnlineParticipants(room.participants).includes(share.owner)));
  return { ...room, isSharing: active, shareHost: active ? share.owner : null, shareSessionId: active ? share.id : null };
}
