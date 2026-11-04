import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Room from '../../src/components/Room';
import DriveTimeline from '../../src/components/DriveTimeline';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const room = { id: 'ROOM', videoSource: 'movie', videoId: '10378', movieKind: 'movie', movieTitle: 'Big Buck Bunny', movieSeason: 0, movieEpisode: 0, mediaSelectionId: 'first', playbackState: 'PAUSED' };
const props = { room, videoId: '10378', vidSrc: 'movie', participants: [], messages: [], msgInput: '', ytUrl: '', vidRef: { current: null }, driveVideoRef: { current: null }, movieFrameRef: { current: null }, containerRef: { current: null } };
it('mounts a fixed-origin movie iframe, replaces it on selection/reload, and removes it on screen sharing', () => {
  const p = render(<Room {...props} isHost moviePlayerGeneration={0} />);
  const original = screen.getByTitle('Room movie player'); expect(new URL(original.src).origin).toBe('https://cinesrc.st');
  expect(screen.getByRole('button', { name: 'Play', exact: true })).toBeTruthy();
  expect(original.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
  p.rerender(<Room {...props} isHost moviePlayerGeneration={1} />); expect(screen.getByTitle('Room movie player')).not.toBe(original);
  p.rerender(<Room {...props} room={{ ...room, isSharing: true }} />); expect(screen.queryByTitle('Room movie player')).toBeNull();
});
it('leaves the iframe available for the device’s own playback permission gesture', () => {
  render(<Room {...props} driveTapNeeded />);
  expect(screen.getByRole('status', { name: 'Movie playback permission' }).textContent).toContain('inside the movie player');
  expect(screen.queryByRole('button', { name: /Tap to Sync/ })).toBeNull();
});
it('uses the existing host timeline with adapter progress instead of reading a hidden video', () => {
  let tick; vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { tick = cb; return 1; }); vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  render(<DriveTimeline mediaAdapter={{ getCurrentTime: () => 42, getDuration: () => 600 }} isHost />);
  act(() => tick(500)); const slider = screen.getByRole('slider', { name: 'Video timeline' }); expect(slider.max).toBe('600'); expect(slider.value).toBe('42');
});
