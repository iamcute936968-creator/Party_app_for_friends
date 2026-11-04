import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVoiceChat } from '../../src/hooks/useVoiceChat';
import Room from '../../src/components/Room';
import { set, onValue, onDisconnect, runTransaction } from '../helpers/firebase-database';
const db = {};
const room = { id: 'ROOM_A', secret: 'fixture-secret', roomName: 'Movie night', host: 'Host', identities: { Host: 'host-uid' }, participants: { Host: true } };
let track, record;
beforeEach(() => {
  vi.clearAllMocks(); record = null; track = { enabled: true, stop: vi.fn() };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] }) } });
  onValue.mockImplementation((target, next) => {
    if (target.path === '/roomAccess/ROOM_A/host-uid') next({ val: () => ({ name: 'Host', secret: room.secret }) });
    return () => {};
  }); set.mockResolvedValue();
  onDisconnect.mockReturnValue({ remove: vi.fn().mockResolvedValue(), cancel: vi.fn().mockResolvedValue() });
  runTransaction.mockImplementation(async (_target, fn) => { const next = fn(record); if (next === undefined) return { committed: false }; record = next; return { committed: true }; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function VoiceRoom({ connected = true }) {
  const voice = useVoiceChat(db, 'ROOM_A', 'Host', room, connected, 'host-uid');
  return <Room room={room} participants={['Host']} messages={[]} floatMsgs={[]} vidRef={{ current: null }}
    driveVideoRef={{ current: null }} containerRef={{ current: null }} ytUrl="" msgInput="" vidSrc="youtube" connectionStatus={connected ? 'connected' : 'reconnecting'} voice={voice} />;
}
it('joins from the visible control, mutes the real track, and releases capture when leaving voice', async () => {
  render(<VoiceRoom />);
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Join voice' })));
  expect(screen.getByRole('status', { name: 'Voice chat status' }).textContent).toContain('Microphone on');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' })));
  expect(track.enabled).toBe(false);
  expect(screen.getByRole('button', { name: 'Unmute microphone' })).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Leave voice' })));
  expect(track.stop).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Join voice' })).toBeTruthy();
});
it('shows microphone permission failures inline and permits another deliberate attempt', async () => {
  navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(new DOMException('private capture details', 'NotAllowedError'));
  render(<VoiceRoom />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Join voice' })));
  expect(screen.getByRole('alert').textContent).toContain('permission');
  expect(screen.queryByText('private capture details')).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Join voice' })));
  expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeTruthy();
});
it('keeps leave/mute and input feedback available while voice reconnects automatically', async () => {
  const { rerender } = render(<VoiceRoom />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Join voice' })));
  await act(async () => rerender(<VoiceRoom connected={false} />));
  expect(screen.getByRole('button', { name: 'Leave voice' })).toBeTruthy();
  expect(screen.getByRole('status', { name: 'Voice chat status' }).textContent).toContain('Reconnecting');
  fireEvent.click(within(screen.getByRole('tabpanel', { name: 'Watch' })).getByText('Voice options', { selector: 'summary' }));
  expect(screen.getByRole('meter', { name: 'Microphone input level' })).toBeTruthy();
  expect(track.stop).not.toHaveBeenCalled();
  await act(async () => rerender(<VoiceRoom />));
  expect(screen.getByRole('status', { name: 'Voice chat status' }).textContent).toContain('Microphone on');
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
});

it('keeps the same live microphone capture when switching between Chat and Watch', async () => {
  render(<VoiceRoom />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Join voice' })));
  fireEvent.click(screen.getByRole('tab', { name: 'Chat', exact: true }));
  expect(within(screen.getByRole('tabpanel', { name: 'Chat' })).getByRole('button', { name: 'Mute microphone' })).toBeTruthy();
  expect(track.stop).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'Watch', exact: true }));
  expect(within(screen.getByRole('tabpanel', { name: 'Watch' })).getByRole('status', { name: 'Voice chat status' }).textContent).toContain('Microphone on');
  expect(track.stop).not.toHaveBeenCalled();
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
});
