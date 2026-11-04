import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from '../../src/components/Home';
import Room from '../../src/components/Room';

afterEach(cleanup);
const homeProps = (overrides = {}) => ({
  username: '', setUsername: vi.fn(), roomId: '', setRoomId: vi.fn(),
  loading: false, create: vi.fn(), join: vi.fn(), rejoinAsHost: vi.fn(),
  myAvatar: { emoji: 'x' }, avOpts: [], setMyAvatar: vi.fn(), ...overrides,
});
const roomProps = (overrides = {}) => ({
  room: { id: 'ROOM_A', roomName: 'Friday movie', host: 'Host', playbackState: 'PAUSED' },
  participants: ['Host', 'Guest'], messages: [], floatMsgs: [],
  vidRef: { current: null }, driveVideoRef: { current: null }, containerRef: { current: null },
  msgInput: '', ytUrl: '', vidSrc: 'youtube', isHost: true,
  connectionStatus: 'connected', copy: vi.fn(), leave: vi.fn(), load: vi.fn(),
  togglePlay: vi.fn(), sendMsg: vi.fn(), setMsgInput: vi.fn(), ...overrides,
});

describe('premium home workflow', () => {
  it('offers a shared, labeled display name with actionable create and join forms', () => {
    const props = homeProps();
    const { rerender } = render(<Home {...props} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('A good film.');
    expect(screen.getByLabelText('Your name')).toBeTruthy();
    expect(screen.getAllByPlaceholderText('Enter your name')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Create Room' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Join Room' }).disabled).toBe(true);
    expect(screen.queryByText('Choose avatar:')).toBeNull();
    rerender(<Home {...props} username="Guest" roomId="ROOM_A" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Room' }));
    fireEvent.click(screen.getByRole('button', { name: 'Join Room' }));
    expect(props.create).toHaveBeenCalledOnce();
    expect(props.join).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    expect(props.setUsername).toHaveBeenCalledWith('Alex');
  });

  it('preserves host recovery without exposing stored authorization secrets', () => {
    const props = homeProps({ username: 'Host', lastHostRoom: { roomId: 'ROOM_A', hostName: 'Host', roomSecret: 'do-not-render-this' } });
    render(<Home {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Rejoin as Host/ }));
    expect(props.rejoinAsHost).toHaveBeenCalledOnce();
    expect(screen.queryByText('do-not-render-this')).toBeNull();
  });

  it('prevents repeated submissions while a room request is pending', () => {
    const props = homeProps({ username: 'Guest', roomId: 'ROOM_A', loading: true });
    render(<Home {...props} />);
    for (const button of document.querySelectorAll('.entry-panel button')) expect(button.disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText('Your name'), { key: 'Enter' });
    expect(props.create).not.toHaveBeenCalled();
    expect(props.join).not.toHaveBeenCalled();
  });
});

describe('premium viewing room controls', () => {
  it('keeps the viewing area, participants, conversation and accessible controls functional', () => {
    const props = roomProps();
    render(<Room {...props} />);
    expect(screen.getByText('Your screen is ready.')).toBeTruthy();
    expect(screen.getByLabelText('Video URL')).toBeTruthy();
    expect(screen.getByLabelText('Message')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy invite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave room' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load video' }));
    expect(props.copy).toHaveBeenCalledOnce();
    expect(props.leave).toHaveBeenCalledOnce();
    expect(props.load).toHaveBeenCalledOnce();
  });

  it('retains member playback boundaries and never inserts peer content as HTML', () => {
    render(<Room {...roomProps({ isHost: false, participants: ['<img src=x onerror=alert(1)>'], messages: [{ type: 'user', user: 'Peer', text: '<script>bad()</script>' }] })} />);
    expect(screen.queryByRole('button', { name: 'Play', exact: true })).toBeNull();
    expect(screen.getByText('<script>bad()</script>')).toBeTruthy();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
  });
});
