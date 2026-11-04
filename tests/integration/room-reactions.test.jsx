import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Room from '../../src/components/Room';
import { useRoomReactions } from '../../src/hooks/useRoomReactions';
import { push } from '../helpers/firebase-database';

const database = {};
const togglePlay = vi.fn();
function ReactionRoom({ records = null, connected = true }) {
  const reactions = useRoomReactions(database, 'ROOM_A', 'Guest', records, connected);
  return <Room room={{ id: 'ROOM_A', roomName: 'Friday movie', host: 'Guest' }}
    isHost participants={['Guest']} connectionStatus={connected ? 'connected' : 'reconnecting'}
    messages={[]} floatMsgs={[]} vidSrc="youtube" videoId="test" ytUrl="" msgInput=""
    containerRef={{ current: null }} driveVideoRef={{ current: null }} vidRef={{ current: null }}
    togglePlay={togglePlay} reactions={reactions.reactions} sendReaction={reactions.send}
    canReact={reactions.canSend} reactionError={reactions.error} />;
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); push.mockResolvedValue({ key: 'reaction' }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('provides labelled icon controls and renders expiring reactions as escaped text', async () => {
  const { rerender } = render(<ReactionRoom />);
  expect(screen.queryByRole('group', { name: 'Send a reaction' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
  expect(screen.getByRole('group', { name: 'Send a reaction' })).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'React with Love' })));
  expect(push).toHaveBeenCalledWith({ path: '/rooms/ROOM_A/reactions' }, expect.objectContaining({ kind: 'love' }));
  expect(togglePlay).not.toHaveBeenCalled();
  const records = { peer: { kind: 'applause', user: '<img src=x onerror=alert(1)>', timestamp: 100000 } };
  rerender(<ReactionRoom records={records} />);
  const feed = screen.getByRole('log', { name: 'Live reactions' });
  expect(feed.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(feed.querySelector('img')).toBeNull();
  expect(feed.textContent).toContain('Applause');
  act(() => vi.advanceTimersByTime(5000));
  expect(feed.textContent).toBe('');
});

it('disables reactions offline and exposes a generic retryable failure without affecting playback', async () => {
  const { rerender } = render(<ReactionRoom connected={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
  expect(screen.getByRole('button', { name: 'React with Like' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'React with Like' }));
  expect(push).not.toHaveBeenCalled();
  rerender(<ReactionRoom />);
  push.mockRejectedValueOnce(new Error('private provider error'));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'React with Like' })));
  expect(screen.getByRole('alert').textContent).toBe('Reaction not sent. Try again.');
  expect(screen.queryByText('private provider error')).toBeNull();
  act(() => vi.advanceTimersByTime(1000));
  fireEvent.click(screen.getByRole('button', { name: 'Reactions' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'React with Applause' })));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(togglePlay).not.toHaveBeenCalled();
});
