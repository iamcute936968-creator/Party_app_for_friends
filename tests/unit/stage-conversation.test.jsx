import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import StageConversation from '../../src/components/StageConversation';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const props = { roomId: 'ROOM_A', username: 'Me', draft: '', setDraft: vi.fn(), send: vi.fn(), status: 'idle' };
it('pops new messages, deduplicates by push ID, expires notices and does not replay history when opening chat', async () => {
  vi.useFakeTimers(); vi.setSystemTime(10000);
  const history = [{ id: 'old', type: 'user', user: 'Peer', text: 'Earlier message', timestamp: 9000 }];
  const { rerender } = render(<StageConversation {...props} messages={history} />);
  const notices = screen.getByRole('log', { name: 'On-screen messages' });
  expect(notices.textContent).toBe('');
  const fresh = { id: 'new', type: 'user', user: 'Peer', text: 'A live message', timestamp: 10000 };
  rerender(<StageConversation {...props} messages={[...history, fresh]} />);
  expect(within(notices).getAllByText('A live message')).toHaveLength(1);
  rerender(<StageConversation {...props} messages={[...history, { ...fresh }]} />);
  expect(within(notices).getAllByText('A live message')).toHaveLength(1);
  expect(screen.getByRole('button', { name: /Open on-screen chat, 1 unread/ })).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(6500));
  expect(notices.textContent).toBe('');
  fireEvent.click(screen.getByRole('button', { name: /Open on-screen chat/ }));
  expect(screen.getByRole('log', { name: 'On-screen conversation' }).textContent).toContain('Earlier message');
  expect(notices.textContent).toBe('');
});

it('renders hostile text as text and clears notifications when switching rooms', () => {
  vi.useFakeTimers(); vi.setSystemTime(10000);
  const { rerender } = render(<StageConversation {...props} messages={[]} />);
  rerender(<StageConversation {...props} messages={[{ id: 'new', type: 'user', user: 'Peer', text: '<img src=x onerror=alert(1)>', timestamp: 10000 }]} />);
  const notices = screen.getByRole('log', { name: 'On-screen messages' });
  expect(notices.textContent).toContain('<img src=x');
  expect(notices.querySelector('img')).toBeNull();
  rerender(<StageConversation {...props} roomId="ROOM_B" messages={[]} />);
  expect(notices.textContent).toBe('');
  expect(screen.queryByRole('button', { name: /unread/ })).toBeNull();
});
it('notifies a newly received push ID even when the sender clock is behind the viewer', () => {
  vi.useFakeTimers(); vi.setSystemTime(10000);
  const { rerender } = render(<StageConversation {...props} messages={[]} clock={{ current: 300000 }} />);
  rerender(<StageConversation {...props} messages={[{ id: 'fresh-push', type: 'user', user: 'Peer', text: 'Clock-skewed arrival', timestamp: 5000 }]} clock={{ current: 300000 }} />);
  expect(screen.getByRole('log', { name: 'On-screen messages' }).textContent).toContain('Clock-skewed arrival');
});
