import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMediaLoad } from '../../src/hooks/useMediaLoad';

afterEach(cleanup);
it('returns an acknowledgement only for a successful current operation', async () => {
  const { result } = renderHook(() => useMediaLoad('ROOM_A'));
  let accepted;
  await act(async () => { accepted = await result.current.run('load', async () => undefined); });
  expect(accepted).toBe(true);
  await act(async () => { accepted = await result.current.run('load', async () => 'Not available'); });
  expect(accepted).toBe(false);
  await act(async () => { accepted = await result.current.run('load', async () => { throw Error('private'); }); });
  expect(accepted).toBe(false);
  await act(async () => { accepted = await result.current.run('load', async () => false); });
  expect(accepted).toBe(false);
  expect(result.current.loaded).toBe(false);
});
it('does not render a successful provider return value as a business error', async () => {
  const { result } = renderHook(() => useMediaLoad('ROOM_A'));
  await act(async () => result.current.run('retry', async () => true));
  expect(result.current.error).toBe('');
});

it('starts an operation synchronously and rejects duplicate loads until acknowledgement', async () => {
  let finish;
  const operation = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  const { result } = renderHook(() => useMediaLoad('ROOM_A'));
  let pending;
  act(() => { pending = result.current.run('load', operation); void result.current.run('authorize', operation); });
  expect(operation).toHaveBeenCalledOnce();
  expect(result.current.action).toBe('load');
  expect(result.current.loaded).toBe(false);
  await act(async () => { finish(); await pending; });
  expect(result.current.action).toBeNull();
  expect(result.current.loaded).toBe(true);
});

it('keeps provider details out of load feedback and permits a deliberate retry', async () => {
  const { result } = renderHook(() => useMediaLoad('ROOM_A'));
  await act(async () => result.current.run('load', async () => { throw new Error('private provider detail'); }));
  expect(result.current.error).toBe('Could not add the video to the room. Try again.');
  expect(result.current.loaded).toBe(false);
  await act(async () => result.current.run('load', async () => undefined));
  expect(result.current.error).toBe('');
  expect(result.current.loaded).toBe(true);
});

it('supports actionable validation without announcing a successful load', async () => {
  const { result } = renderHook(() => useMediaLoad('ROOM_A'));
  await act(async () => result.current.run('load', async () => 'Enter a valid YouTube or Google Drive link.'));
  expect(result.current.error).toBe('Enter a valid YouTube or Google Drive link.');
  expect(result.current.loaded).toBe(false);
});

it('handles authorization rejections without claiming that a video was added', async () => {
  const { result } = renderHook(() => useMediaLoad('ROOM_A'));
  await act(async () => result.current.run('authorize', async () => { throw new Error('private OAuth detail'); }));
  expect(result.current.error).toBe('Could not authorize Google Drive. Try again.');
  await act(async () => result.current.run('authorize', async () => undefined));
  expect(result.current.error).toBe('');
  expect(result.current.loaded).toBe(false);
});

it('invalidates a pending continuation and its feedback when the room changes', async () => {
  let finish;
  let isCurrent;
  const publish = vi.fn();
  const { result, rerender } = renderHook(({ roomId }) => useMediaLoad(roomId), { initialProps: { roomId: 'ROOM_A' } });
  let pending;
  act(() => { pending = result.current.run('load', async (active) => {
    isCurrent = active;
    await new Promise((resolve) => { finish = resolve; });
    if (active()) publish();
    throw new Error('private old-room error');
  }); });
  expect(isCurrent()).toBe(true);
  rerender({ roomId: 'ROOM_B' });
  expect(isCurrent()).toBe(false);
  await act(async () => result.current.run('load', async () => undefined));
  await act(async () => { finish(); await pending; });
  expect(publish).not.toHaveBeenCalled();
  expect(result.current.error).toBe('');
  expect(result.current.loaded).toBe(true);
});

it('invalidates continuations after unmount and works through StrictMode cleanup', async () => {
  let isCurrent;
  let finish;
  const { result, unmount } = renderHook(() => useMediaLoad('ROOM_A'), { reactStrictMode: true });
  let pending;
  act(() => { pending = result.current.run('load', async (active) => {
    isCurrent = active;
    await new Promise((resolve) => { finish = resolve; });
  }); });
  expect(isCurrent()).toBe(true);
  unmount();
  expect(isCurrent()).toBe(false);
  await act(async () => { finish(); await pending; });
});

it('does not run a media operation outside a room', async () => {
  const operation = vi.fn();
  const { result } = renderHook(() => useMediaLoad(null));
  await act(async () => result.current.run('load', operation));
  expect(operation).not.toHaveBeenCalled();
});

it('reports retry failures without claiming that a new video was added', async () => {
  const { result } = renderHook(() => useMediaLoad('ROOM_A'));
  await act(async () => result.current.run('retry', async () => { throw new Error('private retry detail'); }));
  expect(result.current.error).toBe('Could not retry this video. Try again.');
  await act(async () => result.current.run('retry', async () => undefined));
  expect(result.current.loaded).toBe(false);
  expect(result.current.error).toBe('');
});
