import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Room from '../../src/components/Room';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const props = { room: { id: 'ROOM', host: 'Host', videoSource: 'movie', videoId: '10378', movieKind: 'movie', mediaSelectionId: 'one' }, vidSrc: 'movie', videoId: '10378', username: 'Host', chatUserId: 'me', messages: [{ id: 'one', type: 'user', user: 'Host', uid: 'me', text: 'Hello', createdAt: Date.now(), time: '10:20' }], participants: ['Host'], msgInput: '', ytUrl: '', vidRef: { current: null }, driveVideoRef: { current: null }, movieFrameRef: { current: null }, containerRef: { current: null }, connectionStatus: 'connected', isHost: true };
it('moves conversation into Chat and keeps the same player when switching back to Watch', () => {
  render(<Room {...props} />); const player = screen.getByTitle('Room movie player');
  expect(screen.queryByRole('log', { name: 'Recent messages' })).toBeNull();
  expect(screen.queryByLabelText('Your avatar colour')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Chat', exact: true }));
  expect(screen.getByRole('log', { name: 'Recent messages' }).textContent).toContain('Hello');
  expect(screen.getByTitle('Room movie player')).toBe(player);
  fireEvent.click(screen.getByRole('tab', { name: 'Watch', exact: true }));
  expect(screen.getByTitle('Room movie player')).toBe(player);
});
it('edits an own message and exposes the expanded reaction picker', async () => {
  const editMessage = vi.fn(async () => true), sendReaction = vi.fn();
  render(<Room {...props} editMessage={editMessage} sendReaction={sendReaction} canReact />);
  fireEvent.click(screen.getByRole('tab', { name: 'Chat', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
  expect(screen.getByLabelText('Edit message text').getAttribute('aria-label')).toBe('Edit message text');
  fireEvent.change(screen.getByLabelText('Edit message text'), { target: { value: 'Updated' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  expect(editMessage).toHaveBeenCalledWith(props.messages[0], 'Updated');
  fireEvent.click(screen.getByRole('tab', { name: 'Watch', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Reactions', exact: true }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Send a reaction' })).getByRole('button', { name: 'React with Sad' }));
  expect(sendReaction).toHaveBeenCalledWith('sad');
});
it('requires host confirmation before deleting stored recordings', async () => {
  const clearVoice = vi.fn(async () => true);
  render(<Room {...props} clearVoice={clearVoice} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Chat', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear stored voice notes' }));
  expect(clearVoice).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm recording cleanup' }));
  expect(clearVoice).toHaveBeenCalledOnce();
});

function recordingFixture(getUserMedia) {
  const recorders = [], NativeURL = globalThis.URL;
  class Recorder {
    static isTypeSupported = type => type === 'audio/webm;codecs=opus';
    constructor(source, options) { this.source = source; this.mimeType = options.mimeType; this.state = 'inactive'; recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); }
    emit() { this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) }); }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('URL', class extends NativeURL { static createObjectURL = vi.fn(() => 'blob:owned-recording'); static revokeObjectURL = vi.fn(); });
  const mediaDevices = navigator.mediaDevices;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  return { recorders, restore: () => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices }) };
}
const recordingStream = track => ({ getTracks: () => [track], getAudioTracks: () => [track] });

it('cancels pending recording permission on Chat to Watch and stops a late owned stream', async () => {
  let grant;
  const owned = { readyState: 'live', stop: vi.fn() }, getUserMedia = vi.fn(() => new Promise(resolve => { grant = resolve; }));
  const fixture = recordingFixture(getUserMedia);
  try {
    render(<Room {...props} sendVoice={vi.fn(async () => true)} />);
    const player = screen.getByTitle('Room movie player');
    fireEvent.click(screen.getByRole('tab', { name: 'Chat', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));
    expect(getUserMedia).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('tab', { name: 'Watch', exact: true }));
    await act(async () => { grant(recordingStream(owned)); await Promise.resolve(); });
    expect(owned.stop).toHaveBeenCalledOnce(); expect(fixture.recorders).toHaveLength(0);
    expect(screen.getByTitle('Room movie player')).toBe(player);
    fireEvent.click(screen.getByRole('tab', { name: 'Chat', exact: true }));
    expect(screen.queryByLabelText('Voice note preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'Record voice note' }).disabled).toBe(false);
  } finally { fixture.restore(); }
});

it('stops recording on Chat to Watch while preserving the original live voice track', async () => {
  const ownedClone = { readyState: 'live', stop: vi.fn() }, original = { readyState: 'live', stop: vi.fn(), clone: vi.fn(() => ownedClone) };
  const voice = { recordingStream: vi.fn(() => recordingStream(original.clone())), status: 'connected' };
  const fixture = recordingFixture(vi.fn());
  try {
    render(<Room {...props} voice={voice} sendVoice={vi.fn(async () => true)} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Chat', exact: true }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record voice note' })); });
    expect(voice.recordingStream).toHaveBeenCalledOnce(); expect(original.clone).toHaveBeenCalledOnce(); expect(fixture.recorders).toHaveLength(1);
    act(() => fixture.recorders[0].emit());
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Watch', exact: true })); await Promise.resolve(); });
    expect(ownedClone.stop).toHaveBeenCalledOnce(); expect(original.stop).not.toHaveBeenCalled();
    expect(fixture.recorders[0].state).toBe('inactive');
    fireEvent.click(screen.getByRole('tab', { name: 'Chat', exact: true }));
    expect(screen.getByLabelText('Voice note preview')).toBeTruthy();
  } finally { fixture.restore(); }
});
