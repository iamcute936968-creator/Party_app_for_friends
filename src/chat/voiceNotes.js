import { get, ref } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
export const VOICE_NOTE_BYTES = 131072;
export const VOICE_NOTE_DURATION = 15000;
export const VOICE_NOTE_LIFETIME = 86400000;
export const VOICE_NOTE_MIMES = ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/ogg;codecs=opus'];
export const validVoiceSlot = value => typeof value === 'string' && /^([0-9]|1[0-9])$/.test(value);
export const validVoiceMetadata = value => Boolean(value && validVoiceSlot(value.slot) && VOICE_NOTE_MIMES.includes(value.mimeType) && Number.isInteger(value.bytes) && value.bytes > 0 && value.bytes <= VOICE_NOTE_BYTES && Number.isInteger(value.durationMs) && value.durationMs > 0 && value.durationMs <= VOICE_NOTE_DURATION);
export function chooseVoiceSlot(messages, uid, now) {
  const slots = new Map();
  for (const message of messages || []) {
    if (!validVoiceSlot(message?.audio?.slot) || !Number.isFinite(message.createdAt)) continue;
    if (!slots.has(message.audio.slot) || slots.get(message.audio.slot).createdAt < message.createdAt) slots.set(message.audio.slot, message);
  }
  for (let i = 0; i < 20; i++) if (!slots.has(String(i))) return String(i);
  const reusable = [...slots].filter(([, message]) => message.uid === uid || message.createdAt <= now - VOICE_NOTE_LIFETIME).sort((a, b) => a[1].createdAt - b[1].createdAt);
  return reusable[0]?.[0] ?? null;
}
export function encodeVoiceBlob(blob) {
  return new Promise((resolve, reject) => {
    if (!blob || blob.size < 1 || blob.size > VOICE_NOTE_BYTES) { reject(Error('Recording is too large.')); return; }
    const reader = new FileReader(); reader.onerror = () => reject(Error('Recording could not be read.'));
    reader.onload = () => { const data = String(reader.result).split(',')[1]; if (!data || data.length > 174764 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) reject(Error('Recording could not be read.')); else resolve(data); };
    reader.readAsDataURL(blob);
  });
}
export async function readVoiceNote(database, roomId, message) {
  if (!roomId || !validVoiceMetadata(message?.audio) || typeof message.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(message.id)) throw Error('Voice note unavailable.');
  const value = (await get(ref(database, `/roomVoiceNotes/${roomId}/${message.audio.slot}`))).val();
  if (!value || value.messageId !== message.id || value.uid !== message.uid || value.createdAt !== message.createdAt || !['mimeType', 'bytes', 'durationMs'].every(key => value[key] === message.audio[key]) || typeof value.data !== 'string' || value.data.length > 174764 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)) throw Error('This voice note is no longer available.');
  const bytes = Uint8Array.from(atob(value.data), character => character.charCodeAt(0));
  if (bytes.length !== value.bytes || bytes.length > VOICE_NOTE_BYTES) throw Error('Voice note unavailable.');
  return new Blob([bytes], { type: value.mimeType });
}
