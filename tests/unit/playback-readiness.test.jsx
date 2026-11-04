import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Room from '../../src/components/Room';

afterEach(cleanup);
it('disables transport until the selected player is ready and preserves a user gesture afterward', () => {
  const togglePlay = vi.fn();
  const props = { room: { roomName: 'Movie night', playbackState: 'PAUSED' }, isHost: true,
    participants: [], messages: [], floatMsgs: [], vidSrc: 'youtube', videoId: 'abcdefghijk',
    vidRef: { current: null }, driveVideoRef: { current: null }, containerRef: { current: null },
    ytUrl: '', msgInput: '', togglePlay };
  const { rerender } = render(<Room {...props} isPlaybackReady={false} />);
  const preparing = screen.getByRole('button', { name: 'Preparing player...' });
  expect(preparing.disabled).toBe(true);
  fireEvent.click(preparing);
  expect(togglePlay).not.toHaveBeenCalled();
  rerender(<Room {...props} isPlaybackReady />);
  fireEvent.click(screen.getByRole('button', { name: 'Play', exact: true }));
  expect(togglePlay).toHaveBeenCalledOnce();
});
