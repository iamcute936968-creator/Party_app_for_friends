import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useParticipantFeatures } from '../../src/hooks/useParticipantFeatures';
import Room from '../../src/components/Room';
import { AvatarPicker } from '../../src/components/ParticipantAvatar';
import { onDisconnect, ref, remove, set } from '../helpers/firebase-database';
const database = {};
beforeEach(() => {
  localStorage.clear(); ref.mockImplementation((_db, path) => ({ path })); set.mockResolvedValue(); remove.mockResolvedValue();
  onDisconnect.mockImplementation(() => ({ remove: vi.fn().mockResolvedValue(), cancel: vi.fn().mockResolvedValue() }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
function People({ roomId = 'A', records = {}, photoURL = '', accountAvatar = false }) {
  const features = useParticipantFeatures(database, roomId, 'Guest', 'guest-uid', 'own-tab', true, photoURL);
  const [draft, setDraft] = useState('');
  return <>{accountAvatar && <section aria-label="Account avatar preferences"><AvatarPicker value={features.avatar} onChange={features.chooseAvatar} /></section>}
    <Room room={{ id: roomId, host: 'Host', typing: records, profiles: { Host: { avatar: 'sand', photoURL } } }}
    participants={['Host', 'Guest']} username="Guest" messages={[]} msgInput={draft} vidSrc="youtube"
    participantFeatures={features} connectionStatus="connected" chatStatus="idle"
    setMsgInput={value => { setDraft(value); features.typing(value); }}
    containerRef={{ current: null }} vidRef={{ current: null }} driveVideoRef={{ current: null }} /></>;
}
it('persists the chosen avatar and only publishes its own UID-bound profile', async () => {
  const view = render(<People accountAvatar />);
  const preferences = screen.getByRole('region', { name: 'Account avatar preferences' });
  expect(view.container.querySelector('.room-shell .avatar-picker')).toBeNull();
  await act(async () => fireEvent.change(within(preferences).getByLabelText('Your avatar colour'), { target: { value: 'coral' } }));
  expect(set).toHaveBeenCalledWith({ path: '/rooms/A/profiles/Guest' }, { avatar: 'coral' });
  fireEvent.click(screen.getByRole('button', { name: 'People (2)', exact: true }));
  expect(within(screen.getByRole('dialog', { name: 'Room people' })).queryByLabelText('Your avatar colour')).toBeNull();
  view.unmount(); render(<People accountAvatar />);
  expect(within(screen.getByRole('region', { name: 'Account avatar preferences' })).getByLabelText('Your avatar colour').value).toBe('coral');
});
it('shares only an opted-in Google photo and removes it when consent is withdrawn', async () => {
  const photoURL = 'https://lh3.googleusercontent.com/a/photo';
  const view = render(<People photoURL={photoURL} />);
  await act(async () => {});
  expect(set).toHaveBeenCalledWith({ path: '/rooms/A/profiles/Guest' }, { avatar: 'slate', photoURL });
  fireEvent.click(screen.getByRole('button', { name: 'People (2)', exact: true }));
  expect(screen.getByRole('dialog', { name: 'Room people' })).toBeTruthy();
  const image = view.container.querySelector('.participants-panel img');
  expect(image?.getAttribute('src')).toBe(photoURL);
  fireEvent.error(image);
  expect(image.hidden).toBe(true);
  view.rerender(<People photoURL="" />);
  await act(async () => {});
  expect(set).toHaveBeenLastCalledWith({ path: '/rooms/A/profiles/Guest' }, { avatar: 'slate' });
  view.rerender(<People photoURL="https://evil.test/tracker" />);
  await act(async () => {});
  expect(view.container.querySelector('.participants-panel img')).toBeNull();
  expect(set.mock.calls.some(([, value]) => value?.photoURL === 'https://evil.test/tracker')).toBe(false);
});
it('publishes activity without draft text, expires idle typing and clears on leaving the room', async () => {
  vi.useFakeTimers(); const view = render(<People />);
  fireEvent.click(screen.getByRole('tab', { name: 'Chat', exact: true }));
  await act(async () => fireEvent.change(within(screen.getByRole('tabpanel', { name: 'Chat' })).getByLabelText('Message'), { target: { value: 'private draft' } }));
  const writes = set.mock.calls.filter(([target]) => target.path.includes('/typing/'));
  expect(writes).toHaveLength(1); expect(writes[0][1]).toEqual({ updatedAt: 1000 });
  expect(JSON.stringify(writes)).not.toContain('private draft');
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(remove).toHaveBeenCalledWith({ path: '/rooms/A/typing/Guest/own-tab' });
  view.rerender(<People roomId="B" />); await act(async () => {});
  expect(remove).toHaveBeenCalledWith({ path: '/rooms/A/typing/Guest/own-tab' });
});
it('shows another online participant typing, then removes the expired notice without another server update', async () => {
  vi.useFakeTimers(); const now = Date.now(); render(<People records={{ Host: { h: { updatedAt: now } } }} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Chat', exact: true }));
  const chat = screen.getByRole('tabpanel', { name: 'Chat' });
  expect(within(chat).getByText('Host is typing…')).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(9000));
  expect(within(chat).queryByText('Host is typing…')).toBeNull();
});
