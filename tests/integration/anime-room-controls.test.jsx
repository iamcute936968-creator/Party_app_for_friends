import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Room from '../../src/components/Room';
afterEach(cleanup);
it('shows the native anime player and host transport with local captions and episode selection', () => {
  const load = vi.fn(), play = vi.fn();
  render(<Room room={{ id: 'ROOM', host: 'Host', animeTitle: 'Naruto', animeEpisode: 1, playbackState: 'PAUSED' }} isHost videoId="ap_naruto" vidSrc="anime"
    participants={[]} messages={[]} vidRef={{ current: null }} driveVideoRef={{ current: null }} containerRef={{ current: null }} msgInput="" ytUrl="" connectionStatus="connected"
    load={load} togglePlay={play} isPlaybackReady animeMedia={{ loading: false, subtitles: [], info: { episodes: [{ number: 1 }, { number: 2 }] } }} />);
  const video = document.querySelector('video[aria-label="Room video"]'); expect(video.style.display).toBe('block');
  fireEvent.click(screen.getByRole('button', { name: 'Play', exact: true })); expect(play).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Watch episode 2', exact: true }));
  expect(load).toHaveBeenCalledWith({ source: 'anime', id: 'ap_naruto', episode: 2, title: 'Naruto' });
});
it('shows YouTube autoplay guidance without covering the embedded player with a native-video overlay', () => {
  render(<Room room={{ id: 'ROOM', host: 'Host' }} username="Guest" videoId="468wQZH-KTo" vidSrc="youtube" youtubeAutoplayBlocked
    participants={[]} messages={[]} msgInput="" ytUrl="" vidRef={{ current: null }} driveVideoRef={{ current: null }} containerRef={{ current: null }} />);
  expect(screen.getByRole('status', { name: 'YouTube playback permission' }).textContent).toContain('Play inside the YouTube player');
  expect(screen.queryByRole('button', { name: /Tap to Sync/ })).toBeNull();
});
