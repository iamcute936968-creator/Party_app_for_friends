import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Room from '../../src/components/Room';
import { useRealtimeConnection } from '../../src/hooks/useRealtimeConnection';
import { onValue } from '../helpers/firebase-database';

afterEach(cleanup);

function roomProps(overrides = {}) {
  return {
    room: { id: 'ROOM_A', roomName: 'Friday movie', playbackState: 'PAUSED' },
    participants: ['Host', 'Guest'],
    messages: [{ type: 'user', user: 'Guest', text: 'Ready!' }],
    floatMsgs: [],
    vidRef: { current: null },
    driveVideoRef: { current: null },
    containerRef: { current: null },
    ytUrl: '',
    msgInput: 'Unsent draft',
    vidSrc: 'youtube',
    isHost: true,
    copy: vi.fn(),
    leave: vi.fn(),
    load: vi.fn(),
    togglePlay: vi.fn(),
    sendMsg: vi.fn(),
    setMsgInput: vi.fn(),
    ...overrides,
  };
}

describe('Room live connection UI', () => {
  it.each([true, false])('shows connection loss and recovery for isHost=%s without altering room controls', (isHost) => {
    const props = roomProps({ isHost });
    const { rerender } = render(<Room {...props} connectionStatus="connecting" />);
    const status = () => screen.getByRole('status', { name: 'Live room connection' });
    expect(status().textContent).toContain('Connecting');
    rerender(<Room {...props} connectionStatus="connected" />);
    expect(status().textContent).toContain('Connected');
    expect(screen.queryByText(/out of date/)).toBeNull();
    rerender(<Room {...props} connectionStatus="reconnecting" />);
    expect(status().textContent).toContain('Reconnecting');
    expect(screen.getByText(/room updates may be out of date/)).toBeTruthy();
    expect(screen.getByLabelText('Message').value).toBe('Unsent draft');
    expect(screen.getByRole('button', { name: 'People (2)' })).toBeTruthy();
    expect(screen.getByText('Ready!')).toBeTruthy();
    expect(props.togglePlay).not.toHaveBeenCalled();
    expect(props.load).not.toHaveBeenCalled();
    rerender(<Room {...props} connectionStatus="connected" />);
    expect(screen.queryByText(/out of date/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    expect(props.copy).toHaveBeenCalledOnce();
  });

  it.each(['<img src=x onerror=alert(1)>', '__proto__', 'constructor', 'toString'])(
    'provides recovery guidance and safely handles unknown status %s', (unknownStatus) => {
    const { rerender } = render(<Room {...roomProps()} connectionStatus="unavailable" />);
    expect(screen.getByText(/Refresh the page to try again/)).toBeTruthy();
    rerender(<Room {...roomProps()} connectionStatus={unknownStatus} />);
    const status = screen.getByRole('status', { name: 'Live room connection' });
    expect(status.textContent).toContain('Connecting');
    expect(status.querySelector('img')).toBeNull();
  });

  it('renders real hook subscription updates through Room and detaches on unmount', () => {
    let next;
    const unsubscribe = vi.fn();
    const database = {};
    const props = roomProps();
    onValue.mockImplementation((_target, callback) => {
      next = callback;
      return unsubscribe;
    });
    function ConnectedRoom() {
      const status = useRealtimeConnection(database, props.room.id);
      return <Room {...props} connectionStatus={status} />;
    }
    const { unmount } = render(<ConnectedRoom />);
    expect(screen.getByRole('status').textContent).toContain('Connecting');
    act(() => next({ val: () => true }));
    expect(screen.getByRole('status').textContent).toContain('Connected');
    act(() => next({ val: () => false }));
    expect(screen.getByRole('status').textContent).toContain('Reconnecting');
    act(() => next({ val: () => true }));
    expect(screen.queryByText(/out of date/)).toBeNull();
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('announces connection changes without moving keyboard focus', () => {
    const props = roomProps();
    const { rerender } = render(<Room {...props} connectionStatus="connected" />);
    const input = screen.getByLabelText('Message');
    input.focus();
    rerender(<Room {...props} connectionStatus="reconnecting" />);
    const status = screen.getByRole('status', { name: 'Live room connection' });
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(document.activeElement).toBe(input);
  });
});
