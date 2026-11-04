import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { push } from '../helpers/firebase-database';
import { getRecentMessages, CHAT_HISTORY_LIMIT } from '../../src/chat/messages';
import { useRoomChat } from '../../src/hooks/useRoomChat';

const database = {};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
afterEach(cleanup);
beforeEach(() => push.mockResolvedValue({ key: 'message_key' }));

describe('bounded recent conversation', () => {
  it('orders messages, supplies stable IDs and retains only the latest fifty', () => {
    const raw = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`key_${String(index).padStart(3, '0')}`, { type: 'user', user: 'Guest', text: `Message ${index}`, timestamp: 80 - index }]));
    const recent = getRecentMessages(raw);
    expect(CHAT_HISTORY_LIMIT).toBe(50);
    expect(recent).toHaveLength(50);
    expect(recent[0].text).toBe('Message 49');
    expect(recent.at(-1)).toMatchObject({ id: 'key_000', text: 'Message 0' });
    expect(raw.key_000.id).toBeUndefined();
  });
  it('supports legacy arrays, deterministic equal timestamps and malformed records', () => {
    expect(getRecentMessages([null, { type: 'system', text: 'Joined' }, false, { type: 'user', user: 'Guest', text: '<script>text</script>', timestamp: NaN }, { text: { invalid: true } }]))
      .toMatchObject([{ id: '1', text: 'Joined' }, { id: '3', text: '<script>text</script>' }]);
    expect(getRecentMessages({ b: { text: 'B', timestamp: 1 }, a: { text: 'A', timestamp: 1 } }).map((message) => message.id)).toEqual(['a', 'b']);
    expect(getRecentMessages(null)).toEqual([]);
  });
  it('does not pass malformed peer names to the React renderer', () => {
    expect(getRecentMessages({ one: { type: 'user', user: { invalid: true }, text: 'Legacy text' } })[0].user).toBe('');
  });
});

describe('chat send lifecycle', () => {
  it('ignores empty messages and sends trimmed text to the current message path', async () => {
    const { result } = renderHook(() => useRoomChat(database, 'ROOM_A', 'Guest'));
    await act(async () => result.current.send());
    expect(push).not.toHaveBeenCalled();
    act(() => result.current.setDraft('  Ready!  '));
    await act(async () => result.current.send());
    expect(push).toHaveBeenCalledWith({ path: '/rooms/ROOM_A/messages' }, expect.objectContaining({ type: 'user', user: 'Guest', text: 'Ready!' }));
    expect(result.current.draft).toBe('');
    expect(result.current.status).toBe('sent');
  });
  it('guards duplicate submissions synchronously while acknowledgement is pending', async () => {
    const pending = deferred(); push.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useRoomChat(database, 'ROOM_A', 'Guest'));
    act(() => result.current.setDraft('Ready'));
    let first;
    act(() => { first = result.current.send(); result.current.send(); });
    expect(result.current.status).toBe('sending');
    expect(push).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve(); await first; });
    expect(result.current.status).toBe('sent');
  });
  it('keeps a failed draft and permits an explicit retry without exposing provider details', async () => {
    push.mockRejectedValueOnce(new Error('private provider details'));
    const { result } = renderHook(() => useRoomChat(database, 'ROOM_A', 'Guest'));
    act(() => result.current.setDraft('Keep this'));
    await act(async () => result.current.send());
    expect(result.current.status).toBe('error');
    expect(result.current.draft).toBe('Keep this');
    expect(JSON.stringify(result.current)).not.toContain('private provider details');
    await act(async () => result.current.send());
    expect(push).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('sent');
    expect(result.current.draft).toBe('');
  });
  it('preserves newer typing when an earlier send succeeds', async () => {
    const pending = deferred(); push.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useRoomChat(database, 'ROOM_A', 'Guest'));
    act(() => result.current.setDraft('First'));
    let sending;
    act(() => { sending = result.current.send(); });
    act(() => result.current.setDraft('Next thought'));
    await act(async () => { pending.resolve(); await sending; });
    expect(result.current.draft).toBe('Next thought');
    expect(result.current.status).toBe('idle');
  });
  it('isolates drafts and acknowledgements across room changes', async () => {
    const pending = deferred(); push.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ room }) => useRoomChat(database, room, 'Guest'), { initialProps: { room: 'ROOM_A' } });
    act(() => result.current.setDraft('Old room'));
    let sending;
    act(() => { sending = result.current.send(); });
    rerender({ room: 'ROOM_B' });
    expect(result.current.draft).toBe('');
    act(() => result.current.setDraft('New room'));
    await act(async () => { pending.resolve(); await sending; });
    expect(result.current.draft).toBe('New room');
    expect(result.current.status).toBe('idle');
  });
  it('does not write outside a room and cleans up StrictMode/unmount safely', async () => {
    const { result, rerender, unmount } = renderHook(({ room }) => useRoomChat(database, room, 'Guest'), { initialProps: { room: null }, reactStrictMode: true });
    act(() => result.current.setDraft('Outside'));
    await act(async () => result.current.send());
    expect(push).not.toHaveBeenCalled();
    rerender({ room: 'ROOM_A' });
    const pending = deferred(); push.mockReturnValueOnce(pending.promise);
    act(() => result.current.setDraft('Inside'));
    let sending;
    act(() => { sending = result.current.send(); });
    unmount();
    await act(async () => { pending.resolve(); await sending; });
    expect(push).toHaveBeenCalledOnce();
  });
});
