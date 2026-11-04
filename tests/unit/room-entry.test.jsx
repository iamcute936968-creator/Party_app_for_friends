import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRoomEntry } from '../../src/hooks/useRoomEntry';

afterEach(cleanup);
it('locks repeated room requests synchronously, then permits a deliberate retry', async () => {
  let resolve;
  const operation = vi.fn(() => new Promise((done) => { resolve = done; }));
  const { result } = renderHook(() => useRoomEntry());
  let first;
  act(() => { first = result.current.run('join', operation); expect(result.current.isPending()).toBe(true); void result.current.run('create', operation); });
  expect(result.current.action).toBe('join');
  expect(operation).toHaveBeenCalledOnce();
  await act(async () => { resolve(); await first; });
  expect(result.current.action).toBeNull();
  expect(result.current.isPending()).toBe(false);
  await act(async () => result.current.run('join', async () => 'Room not found. Check your invite and try again.'));
  expect(result.current.error).toBe('Room not found. Check your invite and try again.');
});
it('replaces provider failures with action-specific safe feedback and clears it on retry', async () => {
  const { result } = renderHook(() => useRoomEntry());
  for (const action of ['create', 'join', 'rejoin']) {
    await act(async () => result.current.run(action, async () => { throw new Error('private database error'); }));
    expect(result.current.error).toBe(`Could not ${action} the room. Try again.`);
    expect(result.current.action).toBeNull();
  }
  await act(async () => result.current.run('join', async () => undefined));
  expect(result.current.error).toBe('');
});
it('discards stale completions after unmount and tolerates StrictMode cleanup', async () => {
  let reject;
  const operation = new Promise((_, fail) => { reject = fail; });
  const { result, unmount } = renderHook(() => useRoomEntry(), { reactStrictMode: true });
  let running;
  act(() => { running = result.current.run('create', () => operation); });
  unmount();
  await act(async () => { reject(new Error('old operation')); await running; });
  expect(result.current.error).toBe('');
});
