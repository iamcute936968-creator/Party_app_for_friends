import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Room from '../../src/components/Room';
import { usePlaybackRecovery } from '../../src/hooks/usePlaybackRecovery';
import { playbackFailure } from '../../src/media/playbackFailure';

afterEach(() => { cleanup(); vi.useRealTimers(); });
function Player({ failure, refresh, enabled = true, source = 'drive' }) {
  const recovery = usePlaybackRecovery('ROOM_A/'+source+'/movie', { enabled, refresh });
  return <><button onClick={() => recovery.report(failure)}>Fail playback</button>
    <button onClick={recovery.ready}>Player ready</button>
    <Room room={{ id: 'ROOM_A', host: 'Host', roomName: 'Movie night' }} participants={[]} messages={[]} floatMsgs={[]}
      vidRef={{ current: null }} driveVideoRef={{ current: null }} containerRef={{ current: null }}
      videoId="movie" vidSrc={source} ytUrl="" msgInput="" playbackError={recovery.error}
      recoveryPhase={recovery.phase} retryPlayback={recovery.retry} canRetryPlayback={enabled} /></>;
}
it('shows actionable unsupported-format feedback without offering endless retries', () => {
  render(<Player failure={playbackFailure('drive', 4)} refresh={vi.fn()} />);
  fireEvent.click(screen.getByText('Fail playback'));
  expect(screen.getByRole('alert').textContent).toContain('MP4');
  expect(screen.queryByRole('button', { name: 'Retry playback' })).toBeNull();
});
it('announces automatic recovery, then clears failure only when the player reports readiness', async () => {
  vi.useFakeTimers();
  render(<Player failure={playbackFailure('drive', 2)} refresh={vi.fn().mockResolvedValue(true)} />);
  fireEvent.click(screen.getByText('Fail playback'));
  expect(screen.getByRole('status', { name: 'Playback recovery' }).textContent).toContain('Retrying');
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByRole('status', { name: 'Playback recovery' }).textContent).toContain('Recovering');
  fireEvent.click(screen.getByText('Player ready'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('status', { name: 'Playback recovery' })).toBeNull();
});
it('disables recovery offline and lets a deliberate retry resume after reconnect', async () => {
  const refresh = vi.fn().mockResolvedValue(false);
  const { rerender } = render(<Player failure={playbackFailure('youtube', 5)} refresh={refresh} enabled={false} source="youtube" />);
  fireEvent.click(screen.getByText('Fail playback'));
  expect(screen.getByRole('button', { name: 'Retry playback' }).disabled).toBe(true);
  rerender(<Player failure={playbackFailure('youtube', 5)} refresh={refresh} source="youtube" />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry playback' })));
  expect(refresh).toHaveBeenCalledOnce();
});
