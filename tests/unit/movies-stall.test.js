import { expect, it } from 'vitest';
import { playbackStalled } from '../../src/movies/stall';
it('flags playing streams whose position stopped advancing', () => {
  const previous = { position: 42, at: 1000 };
  expect(playbackStalled(previous, { position: 42, state: 'playing' }, 1000 + 15000)).toBe(true);
  expect(playbackStalled(previous, { position: 42, state: 'playing' }, 1000 + 14999)).toBe(false);
  expect(playbackStalled(previous, { position: 43, state: 'playing' }, 1000 + 15000)).toBe(false); // moving
  expect(playbackStalled(previous, { position: 42, state: 'paused' }, 1000 + 15000)).toBe(false); // paused is fine
  expect(playbackStalled(null, { position: 42, state: 'playing' }, 20000)).toBe(false);
});
