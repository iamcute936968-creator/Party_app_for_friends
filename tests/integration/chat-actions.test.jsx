import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { update, push } from '../helpers/firebase-database';
import { useRoomChat } from '../../src/hooks/useRoomChat';
afterEach(cleanup);
const database = {};
beforeEach(() => { update.mockResolvedValue(); push.mockReturnValue({ key: '-1234567890123456789' }); });
it('updates only own recent text and leaves immutable fields to the server', async () => {
  const message = { id: 'one', uid: 'me', type: 'user', createdAt: Date.now(), text: 'Old' };
  const { result } = renderHook(() => useRoomChat(database, 'ROOM', 'Host', 'me'));
  let accepted; await act(async () => { accepted = await result.current.edit(message, 'New'); });
  expect(accepted).toBe(true); expect(update).toHaveBeenCalledWith({ path: '/rooms/ROOM/messages/one' }, { text: 'New', editedAt: 1000 });
  update.mockClear(); await act(async () => result.current.edit({ ...message, uid: 'other' }, 'Forged'));
  expect(update).not.toHaveBeenCalled();
});
it('publishes a bounded voice note outside the room snapshot with an atomic message reference', async () => {
  const { result } = renderHook(() => useRoomChat(database, 'ROOM', 'Host', 'me'));
  let accepted; await act(async () => { accepted = await result.current.sendVoice({ blob: new Blob(['abc'], { type: 'audio/webm' }), mimeType: 'audio/webm', durationMs: 1000 }); });
  expect(accepted).toBe(true);
  const paths = update.mock.calls[0][1]; expect(paths['rooms/ROOM/messages/-1234567890123456789'].audio.slot).toBe('0');
  expect(paths['roomVoiceNotes/ROOM/0'].data).toBe('YWJj'); expect(paths['rooms/ROOM/messages/-1234567890123456789'].data).toBeUndefined();
});
it('uses retained slot summaries after chat history is truncated and scopes them to the active room', async () => {
  const recordsRef = { current: { roomId: 'ROOM', messages: [{ uid: 'other', createdAt: Date.now(), audio: { slot: '0' } }] } };
  const { result } = renderHook(() => useRoomChat(database, 'ROOM', 'Host', 'me', { recordsRef }));
  await act(async () => result.current.sendVoice({ blob: new Blob(['abc']), mimeType: 'audio/webm', durationMs: 1000 }));
  expect(update.mock.calls[0][1]['rooms/ROOM/messages/-1234567890123456789'].audio.slot).toBe('1');
});
it('clears only the twenty bounded recording slots when the active host confirms cleanup', async () => {
  const { result, rerender } = renderHook(({ isHost }) => useRoomChat(database, 'ROOM', 'Host', 'me', { isHost }), { initialProps: { isHost: false } });
  expect(await result.current.clearVoice()).toBe(false); expect(update).not.toHaveBeenCalled();
  rerender({ isHost: true });
  let accepted; await act(async () => { accepted = await result.current.clearVoice(); });
  expect(accepted).toBe(true);
  expect(update).toHaveBeenCalledWith({ path: '/' }, Object.fromEntries(Array.from({ length: 20 }, (_, n) => [`roomVoiceNotes/ROOM/${n}`, null])));
});

it('waits for matching room history before sending a voice note or clearing recordings', async () => {
  const recordsRef = { current: { roomId: 'PREVIOUS_ROOM', messages: [] } };
  const { result, rerender } = renderHook(() => useRoomChat(database, 'ROOM', 'Host', 'me', { recordsRef, isHost: true }));
  let sent, cleared;
  await act(async () => { sent = await result.current.sendVoice({ blob: new Blob(['abc']), mimeType: 'audio/webm', durationMs: 1000 }); });
  await act(async () => { cleared = await result.current.clearVoice(); });
  expect(sent).toBe(false); expect(cleared).toBe(false); expect(update).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
  recordsRef.current = { roomId: 'ROOM', messages: [] }; rerender();
  await act(async () => { sent = await result.current.sendVoice({ blob: new Blob(['abc']), mimeType: 'audio/webm', durationMs: 1000 }); });
  expect(sent).toBe(true);
});

it('clears every historical audio message and bounded slot without touching ordinary text or system messages', async () => {
  const voices = Array.from({ length: 70 }, (_, index) => ({ id: '-' + String(index).padStart(19, '0'), uid: 'peer', type: 'user', text: 'Voice message',
    createdAt: Date.now() - 100000 - index, audio: { slot: String(index % 20), mimeType: 'audio/webm', bytes: 3, durationMs: 1000 } }));
  const recordsRef = { current: { roomId: 'ROOM', messages: [...voices, { id: 'ordinary-text', type: 'user', text: 'Keep this' }, { id: 'system-message', type: 'system', text: 'Joined' }] } };
  const { result } = renderHook(() => useRoomChat(database, 'ROOM', 'Host', 'me', { recordsRef, isHost: true }));
  let accepted; await act(async () => { accepted = await result.current.clearVoice(); });
  expect(accepted).toBe(true); expect(update).toHaveBeenCalledOnce();
  const [target, patch] = update.mock.calls[0]; expect(target).toEqual({ path: '/' });
  expect(Object.keys(patch)).toHaveLength(90);
  for (const message of voices) expect(patch[`rooms/ROOM/messages/${message.id}`]).toBeNull();
  for (let slot = 0; slot < 20; slot++) expect(patch[`roomVoiceNotes/ROOM/${slot}`]).toBeNull();
  expect(patch['rooms/ROOM/messages/ordinary-text']).toBeUndefined(); expect(patch['rooms/ROOM/messages/system-message']).toBeUndefined();
  expect(Object.keys(patch).some(path => path.includes('PREVIOUS_ROOM'))).toBe(false);
});
