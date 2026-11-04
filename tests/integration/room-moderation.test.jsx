import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Room from '../../src/components/Room';
import { useRoomModeration } from '../../src/hooks/useRoomModeration';
import { get, onValue, update } from '../helpers/firebase-database';
const room = { id: 'ROOM_A', host: 'Host', hostUid: 'host-uid', identities: { Host: 'host-uid', Guest: 'guest-uid' },
  seats: { 0: { name: 'Host', uid: 'host-uid' }, 1: { name: 'Guest', uid: 'guest-uid' } } };
const props = { room, participants: ['Host', 'Guest'], messages: [], msgInput: '', username: 'Host', connectionStatus: 'connected',
  containerRef: { current: null }, vidRef: { current: null }, driveVideoRef: { current: null } };
beforeEach(() => {
  get.mockResolvedValue({ val: () => room }); update.mockResolvedValue();
  onValue.mockImplementation((_ref, next) => { next({ val: () => ({ 'old-guest': { name: '<img src=x>', createdAt: 1 } }) }); return vi.fn(); });
});
afterEach(() => cleanup());
const database = {};
function Host() { const moderation = useRoomModeration({ database, roomId: 'ROOM_A', uid: 'host-uid', isHost: true });
  return <Room {...props} isHost moderation={moderation} />; }
it('requires a host confirmation before atomically banning a nonhost and supports unban', async () => {
  render(<Host />);
  fireEvent.click(screen.getByRole('button', { name: 'People (2)', exact: true }));
  expect(screen.getByRole('dialog', { name: 'Room people' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Ban Host', exact: true })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ban Guest', exact: true }));
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm ban', exact: true }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0][1]['roomBans/ROOM_A/guest-uid']).toMatchObject({ name: 'Guest' });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm ban', exact: true })).toBeNull());
  fireEvent.click(screen.getByText('Banned members (1)', { exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Unban <img src=x>', exact: true }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update.mock.calls[1][1]).toEqual({ 'roomBans/ROOM_A/old-guest': null });
  expect(document.querySelector('.participants-panel img')).toBeNull();
});
it('hides host controls from members and never exposes the private ban list', () => {
  render(<Room {...props} isHost={false} moderation={{ banned: [{ uid: 'x', name: 'Secret' }], remove: vi.fn() }} />);
  fireEvent.click(screen.getByRole('button', { name: 'People (2)', exact: true }));
  const people = screen.getByRole('dialog', { name: 'Room people' });
  expect(within(people).queryByRole('button', { name: /Ban Guest|Remove Guest/ })).toBeNull();
  expect(within(people).queryByText('Secret')).toBeNull();
});
it('reports failed moderation safely and lets the host retry', async () => {
  update.mockRejectedValueOnce(new Error('private backend details'));
  render(<Host />);
  fireEvent.click(screen.getByRole('button', { name: 'People (2)', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove Guest', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm removal', exact: true }));
  await screen.findByText('Room moderation could not finish. Refresh the room and try again.');
  expect(screen.queryByText('private backend details')).toBeNull();
});
