import { expect, it, vi } from 'vitest';
import { getExpectedPosition, reconcilePlayback } from '../../src/media/playbackSync';
const clock = { playbackState: 'PLAYING', anchorTime: 10, updatedAt: 1000 };
const player = (state = 'PLAYING', time = 10) => ({ getState: () => state, getCurrentTime: () => time,
  getDuration: () => 100, seek: vi.fn(), play: vi.fn(), pause: vi.fn(), setPlaybackRate: vi.fn() });
it('validates clocks and never advances a future anchor backwards', () => {
  expect(getExpectedPosition(clock, 0, 2000)).toBe(11);
  expect(getExpectedPosition(clock, 0, 500)).toBe(10);
  expect(getExpectedPosition({ ...clock, anchorTime: Infinity }, 0, 2000)).toBeNull();
  expect(getExpectedPosition({ ...clock, playbackState: 'bad' }, 0, 2000)).toBeNull();
});
it('gently corrects small drift and restores normal rate inside the tolerance', () => {
  const behind = player('PLAYING', 9); reconcilePlayback(behind, clock, 0, 1000);
  expect(behind.seek).not.toHaveBeenCalled(); expect(behind.setPlaybackRate).toHaveBeenCalledWith(1.03);
  const ahead = player('PLAYING', 11); reconcilePlayback(ahead, clock, 0, 1000);
  expect(ahead.setPlaybackRate).toHaveBeenCalledWith(0.97);
  const aligned = player(); reconcilePlayback(aligned, clock, 0, 1000);
  expect(aligned.setPlaybackRate).toHaveBeenCalledWith(1);
});
it('aligns late joins, clamps the end and avoids seeking while buffering', () => {
  const late = player('CUED', 0); reconcilePlayback(late, clock, 0, 1000);
  expect(late.seek).toHaveBeenCalledWith(10); expect(late.play).toHaveBeenCalledOnce();
  const stalled = player('BUFFERING', 0); reconcilePlayback(stalled, clock, 0, 1000);
  expect(stalled.seek).not.toHaveBeenCalled(); expect(stalled.play).not.toHaveBeenCalled();
  reconcilePlayback(stalled, { ...clock, playbackState: 'PAUSED' }, 0, 1000);
  expect(stalled.pause).toHaveBeenCalledOnce();
  const ended = player('ENDED', 100); reconcilePlayback(ended, { ...clock, anchorTime: 120 }, 0, 1000);
  expect(ended.play).not.toHaveBeenCalled(); expect(ended.pause).toHaveBeenCalledOnce();
  const nearEnd = player('PLAYING', 99); reconcilePlayback(nearEnd, { ...clock, anchorTime: 120 }, 0, 1000);
  expect(nearEnd.seek).toHaveBeenCalledWith(100);
});
