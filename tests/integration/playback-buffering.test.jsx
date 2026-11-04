import { afterEach, expect, it, vi } from 'vitest';
import { createHTML5Adapter } from '../../src/adapters/HTML5Adapter';
import { reconcilePlayback } from '../../src/media/playbackSync';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import Room from '../../src/components/Room';
import { playbackFailure } from '../../src/media/playbackFailure';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('turns a no-video metadata event into actionable room feedback', () => {
  const video = document.createElement('video');
  Object.defineProperties(video, { readyState: { value: 4 }, duration: { value: 65.8 }, videoWidth: { value: 0 }, videoHeight: { value: 0 } });
  vi.spyOn(video, 'load').mockImplementation(() => {}); vi.spyOn(video, 'pause').mockImplementation(() => {});
  const adapter = createHTML5Adapter(video, 'blob:owned'); let failure;
  adapter.onError(error => { failure = playbackFailure('drive', error); });
  video.dispatchEvent(new Event('loadedmetadata'));
  render(<Room room={{ id: 'A' }} participants={[]} messages={[]} msgInput="" vidSrc="drive" videoId="clip"
    playbackError={failure} containerRef={{ current: null }} vidRef={{ current: null }} driveVideoRef={{ current: null }} />);
  expect(screen.getByRole('alert').textContent).toContain('H.264');
  expect(screen.queryByRole('button', { name: 'Retry playback' })).toBeNull();
  adapter.destroy({ revokeObjectUrl: false });
});
it('does not call an adequately buffered player stalled just because network fetching pauses', () => {
  const video = document.createElement('video');
  Object.defineProperties(video, { readyState: { value: 4 }, paused: { value: false } });
  vi.spyOn(video, 'load').mockImplementation(() => {}); vi.spyOn(video, 'pause').mockImplementation(() => {});
  const adapter = createHTML5Adapter(video, 'blob:owned'); const buffering = vi.fn();
  adapter.onBufferingChange(buffering); video.dispatchEvent(new Event('stalled'));
  expect(buffering).not.toHaveBeenCalled(); adapter.destroy({ revokeObjectUrl: false });
});
it('shows buffering feedback without replacing the viewing stage', () => {
  render(<Room room={{ id: 'A' }} participants={[]} messages={[]} msgInput="" vidSrc="youtube" videoId="abcdefghijk"
    isBuffering containerRef={{ current: null }} vidRef={{ current: null }} driveVideoRef={{ current: null }} />);
  expect(screen.getByRole('status', { name: 'Playback buffering' }).textContent).toContain('Buffering');
});
it('resynchronizes actual adapter events after buffering and removes its recovery listener on destroy', () => {
  const video = document.createElement('video'); let ready = 4;
  Object.defineProperties(video, { readyState: { get: () => ready }, paused: { get: () => false }, duration: { get: () => 100 } });
  vi.spyOn(video, 'load').mockImplementation(() => {}); vi.spyOn(video, 'pause').mockImplementation(() => {});
  vi.spyOn(video, 'play').mockResolvedValue();
  const adapter = createHTML5Adapter(video, 'blob:owned');
  const room = { playbackState: 'PLAYING', anchorTime: 20, updatedAt: 1000 };
  const changes = vi.fn(buffering => { if (!buffering) reconcilePlayback(adapter, room, 0, 1000); });
  adapter.onBufferingChange(changes);
  ready = 2; video.dispatchEvent(new Event('waiting')); reconcilePlayback(adapter, room, 0, 1000);
  expect(video.currentTime).toBe(0);
  ready = 4; video.dispatchEvent(new Event('canplay'));
  expect(video.currentTime).toBe(20); expect(changes.mock.calls.map(c => c[0])).toEqual([true, false]);
  adapter.destroy({ revokeObjectUrl: false }); video.dispatchEvent(new Event('waiting'));
  expect(changes).toHaveBeenCalledTimes(2);
});
