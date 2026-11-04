import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Room from '../../src/components/Room';
import Home from '../../src/components/Home';
import { useRoomInvite } from '../../src/hooks/useRoomInvite';
import { useRoomEntry } from '../../src/hooks/useRoomEntry';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function InviteRoom({ roomId = 'ROOM_A', secret = 'fixture-secret' }) {
  const invite = useRoomInvite(roomId, secret, 'https://party.example/');
  return <Room room={{ id: roomId, host: 'Host', roomName: 'Movie night' }}
    participants={[]} messages={[]} floatMsgs={[]} vidSrc="youtube" msgInput="" ytUrl=""
    vidRef={{ current: null }} driveVideoRef={{ current: null }} containerRef={{ current: null }}
    copy={invite.copy} copied={invite.status === 'copied'} shareInvite={invite.share}
    inviteUrl={invite.url} inviteStatus={invite.status} inviteError={invite.error} />;
}
function EntryHome({ operation, lastHostRoom }) {
  const [username, setUsername] = useState('Guest');
  const [roomId, setRoomId] = useState('ROOM_A');
  const entry = useRoomEntry();
  return <Home username={username} setUsername={setUsername} roomId={roomId} setRoomId={setRoomId}
    loading={Boolean(entry.action)} entryAction={entry.action} entryError={entry.error}
    join={() => entry.run('join', operation)} create={() => entry.run('create', operation)}
    lastHostRoom={lastHostRoom} rejoinAsHost={() => entry.run('rejoin', operation)} />;
}
it('offers a selectable manual invite when copying fails, and confirms a successful retry', async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error('private clipboard detail')).mockResolvedValueOnce(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  render(<InviteRoom />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy invite' })));
  expect(screen.queryByRole('button', { name: 'Invite copied' })).toBeNull();
  expect(screen.getByRole('alert').textContent).toBe('Could not copy the invite. Copy the link below.');
  const input = screen.getByLabelText('Invite link');
  expect(input.readOnly).toBe(true);
  expect(new URL(input.value).searchParams.get('room')).toBe('ROOM_A');
  fireEvent.focus(input);
  expect(input.selectionEnd - input.selectionStart).toBe(input.value.length);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy invite' })));
  expect(screen.getByRole('button', { name: 'Invite copied' })).toBeTruthy();
  expect(screen.queryByLabelText('Invite link')).toBeNull();
});
it('provides a native share control without altering playback controls', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { share });
  render(<InviteRoom />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share invite' })));
  expect(share).toHaveBeenCalledOnce();
  expect(screen.getByRole('status', { name: 'Invite feedback' }).textContent).toBe('Share options opened.');
});
it('retains entry fields, focuses safe feedback, and disables editing while a request is pending', async () => {
  let reject;
  const operation = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValueOnce(undefined);
  render(<EntryHome operation={operation} />);
  fireEvent.click(screen.getByRole('button', { name: 'Join Room' }));
  expect(screen.getByRole('button', { name: 'Joining...' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Create Room' }).disabled).toBe(true);
  expect(screen.getByLabelText('Your name').disabled).toBe(true);
  await act(async () => reject(new Error('private server detail')));
  expect(screen.getByRole('alert').textContent).toBe('Could not join the room. Try again.');
  expect(document.activeElement).toBe(screen.getByRole('alert'));
  expect(screen.getByLabelText('Your name').value).toBe('Guest');
  expect(screen.getByLabelText('Room code or invite link').value).toBe('ROOM_A');
  expect(screen.getByLabelText('Your name').disabled).toBe(false);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Join Room' })));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('disables both invite actions until clipboard confirmation and prevents duplicate UI requests', async () => {
  let resolve;
  const writeText = vi.fn(() => new Promise((done) => { resolve = done; }));
  const share = vi.fn();
  vi.stubGlobal('navigator', { clipboard: { writeText }, share });
  render(<InviteRoom />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy invite' }));
  const copying = screen.getByRole('button', { name: 'Copying...' });
  expect(copying.disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Share invite' }).disabled).toBe(true);
  fireEvent.click(copying);
  fireEvent.click(screen.getByRole('button', { name: 'Share invite' }));
  expect(writeText).toHaveBeenCalledOnce();
  expect(share).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Invite copied' })).toBeNull();
  await act(async () => resolve());
  expect(screen.getByRole('button', { name: 'Invite copied' }).disabled).toBe(false);
  expect(screen.getByRole('button', { name: 'Share invite' }).disabled).toBe(false);
});

it('handles cancelled native sharing quietly without copying or exposing a fallback link', async () => {
  const writeText = vi.fn();
  const share = vi.fn().mockRejectedValue(new DOMException('private cancellation detail', 'AbortError'));
  vi.stubGlobal('navigator', { clipboard: { writeText }, share });
  render(<InviteRoom />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share invite' })));
  expect(share).toHaveBeenCalledOnce();
  expect(writeText).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByLabelText('Invite link')).toBeNull();
  expect(screen.queryByRole('status', { name: 'Invite feedback' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Share invite' }).disabled).toBe(false);
});

it('provides a usable manual invite when neither native sharing nor clipboard access is available', async () => {
  vi.stubGlobal('navigator', {});
  render(<InviteRoom />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share invite' })));
  expect(screen.getByRole('alert').textContent).toBe('Could not copy the invite. Copy the link below.');
  const link = screen.getByLabelText('Invite link');
  expect(link.readOnly).toBe(true);
  expect(new URL(link.value).searchParams.get('room')).toBe('ROOM_A');
  expect(screen.getByRole('button', { name: 'Copy invite' }).disabled).toBe(false);
});

it('keeps an old room clipboard failure out of the new room and uses the new invite on retry', async () => {
  let reject;
  const writeText = vi.fn()
    .mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }))
    .mockRejectedValueOnce(new Error('private new-room detail'));
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const { rerender } = render(<InviteRoom />, { reactStrictMode: true });
  fireEvent.click(screen.getByRole('button', { name: 'Copy invite' }));
  rerender(<InviteRoom roomId="ROOM_B" secret="second-fixture-secret" />);
  await act(async () => reject(new Error('private old-room detail')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByLabelText('Invite link')).toBeNull();
  expect(screen.getByRole('button', { name: 'Copy invite' }).disabled).toBe(false);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy invite' })));
  const link = new URL(screen.getByLabelText('Invite link').value);
  expect(link.searchParams.get('room')).toBe('ROOM_B');
  expect(link.searchParams.get('s')).toBe('second-fixture-secret');
  expect(document.body.textContent).not.toContain('private old-room detail');
  expect(document.body.textContent).not.toContain('private new-room detail');
});

it.each([
  ['create', 'Create Room', 'Creating...'],
  ['rejoin', 'Rejoin as Host', 'Rejoining...'],
])('recovers the %s form after a provider failure while preserving the entered values', async (action, label, pendingLabel) => {
  let reject;
  const operation = vi.fn()
    .mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }))
    .mockResolvedValueOnce(undefined);
  render(<EntryHome operation={operation} lastHostRoom={{ roomId: 'ROOM_A', roomSecret: 'fixture-secret' }} />);
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(screen.getByRole('button', { name: pendingLabel }).disabled).toBe(true);
  expect(screen.getByLabelText('Your name').disabled).toBe(true);
  expect(screen.getByLabelText('Room code or invite link').disabled).toBe(true);
  await act(async () => reject(new Error('private provider detail')));
  expect(screen.getByRole('alert').textContent).toBe(`Could not ${action} the room. Try again.`);
  expect(document.activeElement).toBe(screen.getByRole('alert'));
  expect(screen.getByLabelText('Your name').value).toBe('Guest');
  expect(screen.getByLabelText('Room code or invite link').value).toBe('ROOM_A');
  expect(document.body.textContent).not.toContain('fixture-secret');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: label })));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(operation).toHaveBeenCalledTimes(2);
});
