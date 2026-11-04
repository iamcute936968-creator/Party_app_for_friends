import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { push } from '../helpers/firebase-database';
import { getLiveReactions, REACTION_LIFETIME, REACTION_LIMIT } from '../../src/reactions/reactions';
import { useRoomReactions } from '../../src/hooks/useRoomReactions';

const database = {};
const clock = { current: 2000 };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  push.mockResolvedValue({ key: 'reaction' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('transient reaction records', () => {
  it('keeps only recent supported records and bounds the visible feed', () => {
    const records = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`key_${i}`, { kind: 'love', user: 'Peer', timestamp: 100000 + i }]));
    records.expired = { kind: 'like', user: 'Old', timestamp: 95020 };
    records.future = { kind: 'like', user: 'Future', timestamp: 999999 };
    records.unknown = { kind: '<img src=x>', user: 'Peer', timestamp: 100020 };
    records.invalid = { kind: 'like', user: {}, timestamp: 100020 };
    records.nan = { kind: 'like', user: 'Peer', timestamp: NaN };
    const live = getLiveReactions(records, 100020);
    expect(REACTION_LIFETIME).toBe(5000);
    expect(REACTION_LIMIT).toBe(4);
    expect(live.map((item) => item.id)).toEqual(['key_16', 'key_17', 'key_18', 'key_19']);
    expect(records.key_19.id).toBeUndefined();
    expect(getLiveReactions(null, 100000)).toEqual([]);
    expect(getLiveReactions([], 100000)).toEqual([]);
  });
  it('uses stable keys for equal timestamps and safely bounds peer names', () => {
    const result = getLiveReactions({ b: { kind: 'like', user: 'B'.repeat(500), timestamp: 100000 }, a: { kind: 'applause', user: '<script>name</script>', timestamp: 100000 } }, 100000);
    expect(result.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result[1].user.length).toBeLessThanOrEqual(40);
  });
});

describe('reaction lifecycle', () => {
  it('expires records without requiring another Firebase event, using the server clock offset', () => {
    const records = { one: { kind: 'love', user: 'Peer', timestamp: 102000 } };
    const { result, unmount } = renderHook(() => useRoomReactions(database, 'ROOM_A', 'Guest', records, true, clock));
    expect(result.current.reactions).toHaveLength(1);
    act(() => vi.advanceTimersByTime(4999));
    expect(result.current.reactions).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.reactions).toEqual([]);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('writes only a reaction record, rejects unknown types and throttles repeated clicks', async () => {
    const { result } = renderHook(() => useRoomReactions(database, 'ROOM_A', 'Guest', null, true, clock));
    await act(async () => { await result.current.send('unknown'); });
    expect(push).not.toHaveBeenCalled();
    await act(async () => { await Promise.all([result.current.send('love'), result.current.send('like')]); });
    expect(push).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith({ path: '/rooms/ROOM_A/reactions' }, { kind: 'love', user: 'Guest', timestamp: 102000 });
    expect(result.current.canSend).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.canSend).toBe(true);
  });
  it('blocks sending outside a room or while known offline', async () => {
    const { result, rerender } = renderHook(({ roomId, connected }) => useRoomReactions(database, roomId, 'Guest', null, connected), { initialProps: { roomId: null, connected: true } });
    await act(async () => result.current.send('love'));
    rerender({ roomId: 'ROOM_A', connected: false });
    await act(async () => result.current.send('love'));
    expect(result.current.canSend).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
  it('shows a generic failure and permits a deliberate retry after cooldown', async () => {
    push.mockRejectedValueOnce(new Error('private Firebase detail'));
    const { result } = renderHook(() => useRoomReactions(database, 'ROOM_A', 'Guest', null, true));
    await act(async () => result.current.send('like'));
    expect(result.current.error).toBe('Reaction not sent. Try again.');
    act(() => vi.advanceTimersByTime(1000));
    await act(async () => result.current.send('applause'));
    expect(result.current.error).toBe('');
    expect(push).toHaveBeenCalledTimes(2);
  });
  it('isolates late failures, timers and visible records across room changes and unmount', async () => {
    let reject;
    push.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const records = { one: { kind: 'like', user: 'Peer', timestamp: 100000 } };
    const { result, rerender, unmount } = renderHook(({ roomId, data }) => useRoomReactions(database, roomId, 'Guest', data, true), { initialProps: { roomId: 'ROOM_A', data: records }, reactStrictMode: true });
    let sending;
    act(() => { sending = result.current.send('love'); });
    rerender({ roomId: 'ROOM_B', data: null });
    await act(async () => { reject(new Error('old room')); await sending; });
    expect(result.current.reactions).toEqual([]);
    expect(result.current.error).toBe('');
    expect(result.current.canSend).toBe(true);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
