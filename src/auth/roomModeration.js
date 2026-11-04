import { get, ref, serverTimestamp, update } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { validParticipantName } from './roomAccess';
const key = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const failure = () => new Error('Room moderation could not finish. Refresh the room and try again.');
async function ownedRoom(database, actorUid, roomId) {
  if (!key(actorUid) || !key(roomId)) throw failure();
  const room = (await get(ref(database, `/rooms/${roomId}`))).val();
  if (!room || room.id !== roomId || room.hostUid !== actorUid) throw failure();
  return room;
}
export async function moderateRoomMember(database, actorUid, roomId, name, ban = false) {
  if (!validParticipantName(name) || typeof ban !== 'boolean') throw failure();
  const room = await ownedRoom(database, actorUid, roomId);
  const uid = room.identities?.[name];
  if (!key(uid) || uid === actorUid || name === room.host) throw failure();
  const base = `rooms/${roomId}`;
  const patch = { [`roomAccess/${roomId}/${uid}`]: null };
  for (const field of ['identities', 'participants', 'voice', 'profiles', 'typing']) patch[`${base}/${field}/${name}`] = null;
  for (const [slot, seat] of Object.entries(room.seats || {})) {
    if (/^[0-5]$/.test(slot) && seat?.uid === uid) patch[`${base}/seats/${slot}`] = null;
  }
  if (room.screenShare?.ownerUid === uid) patch[`${base}/screenShare`] = null;
  if (ban) patch[`roomBans/${roomId}/${uid}`] = { name, createdAt: serverTimestamp() };
  await update(ref(database), patch);
}
export async function unbanRoomMember(database, actorUid, roomId, uid) {
  if (!key(uid) || uid === actorUid) throw failure();
  await ownedRoom(database, actorUid, roomId);
  await update(ref(database), { [`roomBans/${roomId}/${uid}`]: null });
}
