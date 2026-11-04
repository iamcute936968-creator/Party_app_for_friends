import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createYouTubeAdapter } from '../../src/adapters/YouTubeAdapter';
import Room from '../../src/components/Room';

afterEach(() => { cleanup(); delete window.YT; });
it('connects the real adapter ready callback to the host transport control', async () => {
  let ready;
  const play = vi.fn();
  window.YT = { Player: function(_id, options) { ready = options.events.onReady; this.playVideo = play; this.destroy = vi.fn(); } };
  function PlayerRoom() {
    const [adapter, setAdapter] = useState(null);
    useEffect(() => { const current = createYouTubeAdapter('yt-player', 'abcdefghijk'); current.onReady(() => setAdapter(current)); return () => current.destroy(); }, []);
    return <Room room={{ roomName: 'Movie night', playbackState: 'PAUSED' }} isHost
      participants={[]} messages={[]} floatMsgs={[]} vidSrc="youtube" videoId="abcdefghijk"
      vidRef={{ current: null }} driveVideoRef={{ current: null }} containerRef={{ current: null }}
      ytUrl="" msgInput="" isPlaybackReady={Boolean(adapter)} togglePlay={() => adapter?.play()} />;
  }
  render(<PlayerRoom />);
  expect(screen.getByRole('button', { name: 'Preparing player...' }).disabled).toBe(true);
  expect(play).not.toHaveBeenCalled();
  await act(async () => ready());
  fireEvent.click(screen.getByRole('button', { name: 'Play', exact: true }));
  expect(play).toHaveBeenCalledOnce();
});
