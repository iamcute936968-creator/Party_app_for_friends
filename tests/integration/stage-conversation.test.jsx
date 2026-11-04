import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Room from '../../src/components/Room';
import { useRoomChat } from '../../src/hooks/useRoomChat';
import { push } from '../helpers/firebase-database';
const database = {};
function ChatRoom({ messages = [] }) {
  const chat = useRoomChat(database, 'ROOM_A', 'Guest', 'guest-uid');
  return <Room room={{ id: 'ROOM_A', roomName: 'Movie night' }} username="Guest" isFs
    participants={[]} messages={messages} floatMsgs={[]} vidSrc="youtube" ytUrl="" msgInput={chat.draft} setMsgInput={chat.setDraft}
    sendMsg={chat.send} chatStatus={chat.status} containerRef={{ current: null }} vidRef={{ current: null }} driveVideoRef={{ current: null }} />;
}
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
it('sends and retries through the real chat hook inside the fullscreen stage with the same retained draft', async () => {
  push.mockRejectedValueOnce(new Error('private detail')).mockResolvedValueOnce({ key: 'ok' });
  render(<ChatRoom />);
  fireEvent.click(screen.getByRole('button', { name: /Open on-screen chat/ }));
  const input = screen.getByLabelText('Message in video');
  fireEvent.change(input, { target: { value: 'Still watching' } });
  const form = input.closest('form');
  await act(async () => fireEvent.submit(form));
  expect(screen.getByLabelText('On-screen message feedback').textContent).toContain('not sent');
  expect(input.value).toBe('Still watching');
  expect(screen.queryByText('private detail')).toBeNull();
  await act(async () => fireEvent.submit(form));
  expect(push).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/rooms/ROOM_A/messages' }), expect.objectContaining({ uid: 'guest-uid', user: 'Guest', text: 'Still watching' }));
  expect(input.value).toBe('');
});
it('places received notifications within the fullscreen element and keeps sending without leaving it', () => {
  const { rerender } = render(<ChatRoom />);
  rerender(<ChatRoom messages={[{ id: 'new', type: 'user', user: 'Host', text: 'Look at this scene', timestamp: Date.now() }]} />);
  const stage = screen.getByRole('button', { name: 'Exit fullscreen' }).closest('.video-stage');
  expect(within(stage).getByRole('log', { name: 'On-screen messages' }).textContent).toContain('Look at this scene');
  fireEvent.click(within(stage).getByRole('button', { name: /Open on-screen chat/ }));
  expect(within(stage).getByLabelText('Message in video')).toBeTruthy();
});
