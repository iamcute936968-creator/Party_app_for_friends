import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../src/components/AnimePage', () => ({ default: () => { throw Error('Failed to fetch catalogue chunk'); } }));
import Room from '../../src/components/Room';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('contains catalogue download failures without unmounting the room player or voice', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<Room isHost room={{ id: 'ROOM', videoSource: 'movie', videoId: '10378', movieKind: 'movie', mediaSelectionId: 'a' }} vidSrc="movie" videoId="10378" participants={[]} messages={[]} msgInput="" ytUrl="" connectionStatus="connected" voice={{ status: 'idle' }} vidRef={{ current: null }} driveVideoRef={{ current: null }} movieFrameRef={{ current: null }} containerRef={{ current: null }} />);
  const player = screen.getByTitle('Room movie player'), voice = screen.getByRole('region', { name: 'Voice chat' });
  fireEvent.click(screen.getByRole('button', { name: 'Browse media' }));
  expect((await screen.findByRole('alert')).textContent).toContain('catalogue');
  expect(screen.getByTitle('Room movie player')).toBe(player);
  expect(screen.getByRole('region', { name: 'Voice chat' })).toBe(voice);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Library', exact: true }));
  expect(screen.queryByRole('alert')).toBeNull();
});
