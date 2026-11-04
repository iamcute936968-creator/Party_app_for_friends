import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Room from '../../src/components/Room';
afterEach(cleanup);
const props = { room: { id: 'ROOM', videoSource: 'movie', videoId: '10378', movieKind: 'movie', movieTitle: 'Film', mediaSelectionId: 'one', playbackState: 'PAUSED' }, videoId: '10378', vidSrc: 'movie', participants: [], messages: [], msgInput: '', ytUrl: '', vidRef: { current: null }, driveVideoRef: { current: null }, movieFrameRef: { current: null }, containerRef: { current: null }, connectionStatus: 'connected' };
it('keeps transport and compact voice by the stage, and the player mounted while browsing', async () => {
  const join = vi.fn(); render(<Room {...props} isHost voice={{ status: 'idle', join }} />);
  const transport = screen.getByRole('group', { name: 'Playback controls' });
  expect(within(transport).getByRole('button', { name: 'Play', exact: true })).toBeTruthy();
  const voice = screen.getByRole('region', { name: 'Voice chat' });
  expect(transport.contains(voice)).toBe(true);
  fireEvent.click(within(voice).getByRole('button', { name: 'Join voice' })); expect(join).toHaveBeenCalledOnce();
  const player = screen.getByTitle('Room movie player');
  fireEvent.click(screen.getByRole('button', { name: 'Browse media' }));
  const browser = await screen.findByRole('dialog', { name: 'Browse media for this room' });
  fireEvent.click(within(browser).getByRole('button', { name: 'Library', exact: true }));
  expect(screen.getByTitle('Room movie player')).toBe(player);
  fireEvent.click(within(browser).getByRole('button', { name: 'Close browser' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByTitle('Room movie player')).toBe(player);
});
it('keeps member transport and disconnected selection disabled', () => {
  const view = render(<Room {...props} />);
  expect(screen.getByRole('button', { name: 'Browse media' }).disabled).toBe(false);
  expect(screen.queryByRole('button', { name: 'Play', exact: true })).toBeNull();
  view.rerender(<Room {...props} isHost connectionStatus="reconnecting" />);
  expect(screen.getByRole('button', { name: 'Browse media' }).disabled).toBe(true);
});
