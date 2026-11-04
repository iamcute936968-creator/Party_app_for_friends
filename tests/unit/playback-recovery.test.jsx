import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { playbackFailure } from '../../src/media/playbackFailure';
import { usePlaybackRecovery } from '../../src/hooks/usePlaybackRecovery';

afterEach(() => { cleanup(); vi.useRealTimers(); });
it('allows a bounded longer readiness window for slow movie providers without restarting their player early', async () => {
  vi.useFakeTimers(); const refresh = vi.fn().mockResolvedValue(true);
  const { result } = renderHook(() => usePlaybackRecovery('ROOM_A/movie/10378', { enabled: true, refresh, readyTimeout: 60000 }));
  act(() => result.current.report({ message: 'Movie unavailable', retryable: true }));
  await act(async () => vi.advanceTimersByTimeAsync(1000)); await act(async () => vi.advanceTimersByTimeAsync(45000));
  expect(refresh).toHaveBeenCalledOnce(); expect(result.current.phase).toBe('recovering');
  await act(async () => vi.advanceTimersByTimeAsync(15001)); expect(result.current.phase).toBe('waiting');
});
it.each([100, 101, 150, 153])('gives actionable, non-retrying YouTube feedback for error %s', (code) => {
  const failure = playbackFailure('youtube', code);
  expect(failure.message).toMatch(/YouTube/);
  expect(failure.retryable).toBe(false);
});
it('distinguishes unsupported/decode errors from recoverable network errors and expired streams', () => {
  expect(playbackFailure('drive', 4).message).toContain('MP4');
  expect(playbackFailure('drive', 3).retryable).toBe(false);
  expect(playbackFailure('drive', 2).retryable).toBe(true);
  expect(playbackFailure('drive', 4, true).retryable).toBe(true);
  expect(playbackFailure('youtube', { data: '<private provider detail>' }).message).not.toContain('private');
});
it('does not tell viewers to re-encode a provider anime stream as an uploaded MP4', () => {
  for (const code of [3, 4]) {
    const result = playbackFailure('anime', { code });
    expect(result.message).toContain('episode'); expect(result.message).not.toContain('MP4');
  }
});
it('uses bounded exponential delays and stops after three automatic recovery attempts', async () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockResolvedValue(false);
  const { result } = renderHook(() => usePlaybackRecovery('ROOM_A/drive/movie', { enabled: true, refresh }));
  act(() => result.current.report(playbackFailure('drive', 2)));
  expect(result.current.phase).toBe('waiting');
  for (const delay of [1000, 2000, 4000]) await act(async () => vi.advanceTimersByTimeAsync(delay));
  expect(refresh).toHaveBeenCalledTimes(3);
  expect(result.current.phase).toBe('error');
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(refresh).toHaveBeenCalledTimes(3);
  await act(async () => result.current.retry());
  expect(refresh).toHaveBeenCalledTimes(4);
});
it('never automatically retries unsupported media', async () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const { result } = renderHook(() => usePlaybackRecovery('ROOM_A/drive/movie', { enabled: true, refresh }));
  act(() => result.current.report(playbackFailure('drive', 4)));
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(refresh).not.toHaveBeenCalled();
  expect(result.current.phase).toBe('error');
});
it('renews before ticket expiry and waits for player readiness before clearing recovery feedback', async () => {
  vi.useFakeTimers(); vi.setSystemTime(100000);
  const refresh = vi.fn().mockResolvedValue(true);
  const { result } = renderHook(() => usePlaybackRecovery('ROOM_A/drive/movie', { enabled: true, refresh, expiresAt: 140000 }));
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(refresh).toHaveBeenCalledOnce();
  expect(result.current.phase).toBe('recovering');
  act(() => result.current.ready());
  expect(result.current.phase).toBe('idle');
});
it('cancels scheduled work offline and isolates old completions and callbacks after a source change', async () => {
  vi.useFakeTimers();
  let finish;
  const refresh = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  const { result, rerender } = renderHook(({ scope, enabled }) => usePlaybackRecovery(scope, { enabled, refresh }), {
    initialProps: { scope: 'ROOM_A/drive/movie', enabled: true },
  });
  act(() => result.current.report(playbackFailure('drive', 2)));
  rerender({ scope: 'ROOM_A/drive/movie', enabled: false });
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(refresh).not.toHaveBeenCalled();
  rerender({ scope: 'ROOM_A/drive/movie', enabled: true });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  const oldReport = result.current.report;
  rerender({ scope: 'ROOM_B/youtube/other', enabled: true });
  await act(async () => finish(false));
  act(() => oldReport(playbackFailure('drive', 2)));
  expect(result.current.error).toBeNull();
  expect(result.current.phase).toBe('idle');
});
it('does not falsely confirm recovery when a player never becomes ready, and clears all timers on unmount', async () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockResolvedValue(true);
  const { result, unmount } = renderHook(() => usePlaybackRecovery('ROOM_A/drive/movie', { enabled: true, refresh }));
  act(() => result.current.report(playbackFailure('drive', 2)));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(result.current.error).toBeTruthy();
  unmount();
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(refresh).toHaveBeenCalledOnce();
});

it('discards in-flight completions while offline and permits fresh recovery after reconnect', async () => {
  vi.useFakeTimers();
  let finish;
  const refresh = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(false);
  const { result, rerender } = renderHook(({ enabled }) => usePlaybackRecovery('ROOM_A/drive/movie', { enabled, refresh }), { initialProps: { enabled: true } });
  act(() => result.current.report(playbackFailure('drive', 2)));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  rerender({ enabled: false });
  await act(async () => finish(true));
  expect(vi.getTimerCount()).toBe(0);
  expect(result.current.phase).toBe('error');
  rerender({ enabled: true });
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('does not consume failure retries for successful scheduled renewals while paused', async () => {
  vi.useFakeTimers(); vi.setSystemTime(100000);
  const refresh = vi.fn().mockResolvedValue(true);
  const { result, rerender } = renderHook(({ expiresAt }) => usePlaybackRecovery('ROOM_A/drive/movie', { enabled: true, expiresAt, refresh }), { initialProps: { expiresAt: 131000 } });
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    act(() => result.current.ready());
    rerender({ expiresAt: Date.now() + 31000 });
  }
  refresh.mockResolvedValue(false);
  act(() => result.current.report(playbackFailure('drive', 2)));
  for (const delay of [1000, 2000, 4000]) await act(async () => vi.advanceTimersByTimeAsync(delay));
  expect(refresh).toHaveBeenCalledTimes(6);
  expect(result.current.phase).toBe('error');
});
