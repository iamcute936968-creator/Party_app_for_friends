import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { expect, it, vi } from 'vitest';
import { animeRoomScope } from '../../src/anime/room';

// Exercise the actual closure without replacing the app's many unrelated hooks.
const source = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');
const handler = source.match(/const togglePlay = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0];
if (!handler) throw Error('The host transport handler must be located for this regression test.');
it.each(['resolve', 'reject', 'adapter', 'seek'])('retires a pending anime play command after %s changes its ownership', async kind => {
  let resolve, reject;
  const pendingPlay = new Promise((done, fail) => { resolve = done; reject = fail; });
  const room = { id: 'ROOM', videoSource: 'anime', videoId: 'ap_naruto', animeEpisode: 1, mediaSelectionId: 'first', playbackState: 'PAUSED' };
  const adapter = { getCurrentTime: () => 90, play: () => pendingPlay, pause: vi.fn() };
  const context = { isNormalizingRef: { current: false }, room, roomRef: { current: room }, playerRef: { current: adapter },
    isLeavingRef: { current: false }, vidSrc: 'anime', animeRoomScope, seekGenerationRef: { current: 0 },
    suppressTimeoutRef: { current: null }, suppressNextStateChange: { current: false }, setDriveTapNeeded: vi.fn(),
    setTimeout: vi.fn(() => 11), clearTimeout: vi.fn(), serverTimestamp: () => 1, ref: (_db, path) => path, db: {}, update: vi.fn(async () => {}) };
  const run = new Function(...Object.keys(context), `${handler}; return togglePlay;`)(...Object.values(context));
  const pending = run(); context.setDriveTapNeeded.mockClear();
  if (kind === 'adapter') context.playerRef.current = { ...adapter };
  else if (kind === 'seek') context.seekGenerationRef.current++;
  else { context.roomRef.current = { ...room, animeEpisode: 2, mediaSelectionId: 'next' }; context.playerRef.current = { ...adapter }; }
  if (kind === 'reject') reject(Error('Old source was released')); else resolve();
  await pending;
  expect(context.update).not.toHaveBeenCalled(); expect(context.setDriveTapNeeded).not.toHaveBeenCalled();
});
