import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import Room from '../../src/components/Room';
import { useRoomChat } from '../../src/hooks/useRoomChat';
import { getRecentMessages } from '../../src/chat/messages';
import { push } from '../helpers/firebase-database';

afterEach(cleanup);
const database = {};
function ChatRoom({ history = {}, roomId = 'ROOM_A' }) {
  const chat = useRoomChat(database, roomId, 'Guest');
  return <Room room={{ id: roomId, roomName: 'Friday movie', host: 'Host' }}
    isHost={false} participants={['Host', 'Guest']} connectionStatus="connected"
    messages={getRecentMessages(history)} floatMsgs={[]} vidSrc="youtube" ytUrl=""
    msgInput={chat.draft} setMsgInput={chat.setDraft} sendMsg={chat.send} chatStatus={chat.status}
    containerRef={{ current: null }} driveVideoRef={{ current: null }} vidRef={{ current: null }} />;
}

it('announces sending, prevents repeated form submits and clears the acknowledged draft', async () => {
  let resolve;
  push.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  render(<ChatRoom />);
  fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
  const composer = screen.getByRole('button', { name: 'Send message' }).closest('form');
  fireEvent.submit(composer); fireEvent.submit(composer);
  expect(screen.getByText('Sending…')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Send message' }).disabled).toBe(true);
  expect(push).toHaveBeenCalledOnce();
  await act(async () => resolve());
  expect(screen.getByText('Sent')).toBeTruthy();
  expect(screen.getByLabelText('Message').value).toBe('');
});

it('shows a generic failure, retains focus/draft, and retries successfully', async () => {
  push.mockRejectedValueOnce(new Error('private database details')).mockResolvedValueOnce({ key: 'ok' });
  render(<ChatRoom />);
  fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
  const input = screen.getByLabelText('Message'); input.focus();
  fireEvent.change(input, { target: { value: 'Still here' } });
  await act(async () => fireEvent.submit(screen.getByRole('button', { name: 'Send message' }).closest('form')));
  expect(screen.getByRole('alert').textContent).toBe('Message not sent. Try again.');
  expect(input.value).toBe('Still here');
  expect(document.activeElement).toBe(input);
  expect(screen.queryByText('private database details')).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry message' })));
  expect(input.value).toBe('');
  expect(push).toHaveBeenCalledTimes(2);
});

it('renders fifty recent escaped messages in an accessible conversation log', () => {
  const history = Object.fromEntries(Array.from({ length: 75 }, (_, index) => [`key_${index}`, { user: 'Peer', text: `Line ${index}`, timestamp: index }]));
  history.key_74.text = '<img src=x onerror=alert(1)>';
  history.key_74.user = { malformed: true };
  render(<ChatRoom history={history} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
  const log = screen.getByRole('log', { name: 'Recent messages' });
  expect(log.querySelectorAll('.chat-bubble')).toHaveLength(50);
  expect(screen.queryByText('Line 24')).toBeNull();
  expect(screen.getByText('Line 25')).toBeTruthy();
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  expect(log.querySelector('img')).toBeNull();
});
