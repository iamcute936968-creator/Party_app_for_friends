export function getExpectedPosition(room, offset = 0, now = Date.now()) {
  if (!room || !['PLAYING', 'PAUSED'].includes(room.playbackState) ||
      !Number.isFinite(room.anchorTime) || !Number.isFinite(room.updatedAt) || room.updatedAt <= 0 ||
      !Number.isFinite(offset) || !Number.isFinite(now)) return null;
  const elapsed = room.playbackState === 'PLAYING' ? Math.max(0, now + offset - room.updatedAt) / 1000 : 0;
  return Math.max(0, room.anchorTime + elapsed);
}

// Local player commands only. The host clock remains authoritative.
export function reconcilePlayback(adapter, room, offset = 0, now = Date.now()) {
  const expected = getExpectedPosition(room, offset, now);
  if (!adapter || expected === null || adapter.getState() === 'UNSTARTED') return;
  const state = adapter.getState();
  const duration = adapter.getDuration?.();
  const target = Number.isFinite(duration) && duration > 0 ? Math.min(duration, expected) : expected;
  const ended = Number.isFinite(duration) && duration > 0 && target >= duration;
  const playing = room.playbackState === 'PLAYING' && !ended;
  const buffering = state === 'BUFFERING';
  const current = adapter.getCurrentTime();
  const drift = Number.isFinite(current) ? target - current : 0;
  if (!buffering && (Math.abs(drift) >= 2 || (ended && Math.abs(drift) >= 0.35))) adapter.seek(target);
  // HTML5 supports a gentle nudge; providers without fractional rates retain hard correction.
  const rate = playing && state === 'PLAYING' && !buffering && Math.abs(drift) >= 0.35 && Math.abs(drift) < 2
    ? (drift > 0 ? 1.03 : 0.97) : 1;
  adapter.setPlaybackRate?.(rate);
  if (playing && state !== 'PLAYING' && !buffering) return adapter.play();
  if (!playing && ['PLAYING', 'BUFFERING', 'CUED', 'ENDED'].includes(state)) adapter.pause();
}
