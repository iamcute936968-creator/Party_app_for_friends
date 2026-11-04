import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onValue, ref } from '../helpers/firebase-database';
import { useRealtimeConnection } from '../../src/hooks/useRealtimeConnection';

const database = {};
let subscriptions;

beforeEach(() => {
  subscriptions = [];
  onValue.mockImplementation((target, next, error) => {
    const subscription = { target, next, error, unsubscribe: vi.fn() };
    subscriptions.push(subscription);
    return subscription.unsubscribe;
  });
});
afterEach(cleanup);

function emit(value, index = subscriptions.length - 1) {
  act(() => subscriptions[index].next({ val: () => value }));
}

describe('useRealtimeConnection', () => {
  it('waits for the SDK before reporting connected', () => {
    const { result } = renderHook(() => useRealtimeConnection(database, 'ROOM_A'));
    expect(result.current).toBe('connecting');
    expect(ref).toHaveBeenCalledWith(database, '.info/connected');
    emit(false);
    expect(result.current).toBe('connecting');
    emit(true);
    expect(result.current).toBe('connected');
  });

  it('reports a lost connection and recovers without a reload', () => {
    const { result } = renderHook(() => useRealtimeConnection(database, 'ROOM_A'));
    emit(true);
    emit(false);
    expect(result.current).toBe('reconnecting');
    emit(true);
    expect(result.current).toBe('connected');
  });

  it.each([null, 'true', 1, {}])('does not treat %j as an established connection', (value) => {
    const { result } = renderHook(() => useRealtimeConnection(database, 'ROOM_A'));
    emit(value);
    expect(result.current).toBe('connecting');
  });

  it('reports subscription failure without exposing SDK error details', () => {
    const { result } = renderHook(() => useRealtimeConnection(database, 'ROOM_A'));
    act(() => subscriptions[0].error(new Error('private upstream details')));
    expect(result.current).toBe('unavailable');
  });

  it('does not subscribe outside a room', () => {
    const { result } = renderHook(() => useRealtimeConnection(database, null));
    expect(result.current).toBe('connecting');
    expect(onValue).not.toHaveBeenCalled();
  });

  it('unsubscribes on room change and ignores callbacks from the old room', () => {
    const { result, rerender } = renderHook(({ roomId }) => useRealtimeConnection(database, roomId), {
      initialProps: { roomId: 'ROOM_A' },
    });
    emit(true);
    rerender({ roomId: 'ROOM_B' });
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    expect(result.current).toBe('connecting');
    emit(true, 0);
    act(() => subscriptions[0].error(new Error('old listener')));
    expect(result.current).toBe('connecting');
    emit(true, 1);
    expect(result.current).toBe('connected');
  });

  it('unsubscribes when leaving the room', () => {
    const { rerender } = renderHook(({ roomId }) => useRealtimeConnection(database, roomId), {
      initialProps: { roomId: 'ROOM_A' },
    });
    rerender({ roomId: null });
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    expect(onValue).toHaveBeenCalledOnce();
  });

  it('cleans up correctly across React StrictMode replay and unmount', () => {
    const { unmount } = renderHook(() => useRealtimeConnection(database, 'ROOM_A'), {
      reactStrictMode: true,
    });
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    unmount();
    expect(subscriptions[1].unsubscribe).toHaveBeenCalledOnce();
  });
});
