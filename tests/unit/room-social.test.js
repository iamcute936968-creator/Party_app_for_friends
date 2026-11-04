import { expect, it } from 'vitest';
import { canEditMessage } from '../../src/chat/messages';
import { chooseVoiceSlot, validVoiceMetadata } from '../../src/chat/voiceNotes';
import { REACTION_KINDS } from '../../src/reactions/reactions';
it('allows own recent text edits, excluding expired, legacy, system and audio records', () => {
  const message = { uid: 'me', type: 'user', text: 'Hello', createdAt: 1000 };
  expect(canEditMessage(message, 'me', 180999)).toBe(true);
  for (const [value, uid, now] of [[message, 'other', 2000], [message, 'me', 181001], [{ ...message, createdAt: undefined }, 'me', 2000], [{ ...message, type: 'system' }, 'me', 2000], [{ ...message, audio: {} }, 'me', 2000]]) expect(canEditMessage(value, uid, now)).toBe(false);
});
it('validates bounded voice metadata and only chooses empty, own or expired slots', () => {
  expect(validVoiceMetadata({ slot: '0', mimeType: 'audio/webm', bytes: 128, durationMs: 5000 })).toBe(true);
  expect(validVoiceMetadata({ slot: '../outside', mimeType: 'text/html', bytes: 999999, durationMs: 5000 })).toBe(false);
  expect(chooseVoiceSlot([], 'me', 1000)).toBe('0');
  const full = Array.from({ length: 20 }, (_, i) => ({ uid: 'other', createdAt: i + 1, audio: { slot: String(i) } }));
  expect(chooseVoiceSlot(full, 'me', 1000)).toBeNull();
  full[5].uid = 'me'; expect(chooseVoiceSlot(full, 'me', 1000)).toBe('5');
  expect(chooseVoiceSlot(full, 'new', 86400050)).toBe('0');
});
it('offers happy, sad, laughter and surprise alongside existing reactions', () => {
  expect(REACTION_KINDS).toEqual(expect.arrayContaining(['like', 'love', 'applause', 'happy', 'sad', 'laugh', 'surprised']));
});
