import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useViewingLibrary } from '../../src/hooks/useViewingLibrary';
import MediaLibrary from '../../src/components/MediaLibrary';
import Home from '../../src/components/Home';
import Room from '../../src/components/Room';
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const media = { source: 'youtube', id: 'abcdefghijk', title: 'Friday movie', position: 40, duration: 100 };
function Library({ choose = () => {} }) {
  const library = useViewingLibrary();
  return <><button onClick={() => library.record(media)}>Save progress</button><MediaLibrary library={library} onChoose={choose} canChoose /></>;
}
it('renders hostile saved titles as text and rejects an invitation instead of saving its secret', () => {
  const title = '<img src=x onerror=alert(1)>';
  const view = render(<MediaLibrary library={{ items: [{ ...media, title, lastWatchedAt: 1 }], persistent: true }} />);
  expect(screen.getByText(title)).toBeTruthy(); expect(view.container.querySelector('img')).toBeNull(); view.unmount();
  render(<Library />); fireEvent.click(screen.getByRole('button', { name: 'Wishlist', exact: true }));
  fireEvent.change(screen.getByLabelText('Save a video link'), { target: { value: 'https://partyapp-fun.netlify.app/?room=A&s=private-test-secret' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save to wishlist', exact: true }).closest('form'));
  expect(screen.getByRole('alert').textContent).toContain('valid HTTPS');
  expect(localStorage.getItem('watchparty.viewing-library.v1')).not.toContain('private-test-secret');
});
it('exposes saved choices from Home and host resume from the actual Room', () => {
  const entry = { ...media, lastWatchedAt: 1, completed: false };
  const library = { items: [entry], persistent: true, toggle: vi.fn() }; const choose = vi.fn(); const resume = vi.fn();
  const view = render(<Home library={library} chooseLibrary={choose} />);
  fireEvent.click(screen.getByRole('link', { name: 'Library', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose Friday movie' })); expect(choose).toHaveBeenCalledWith(entry);
  view.unmount();
  const roomProps = { room: { id: 'A' }, participants: [], messages: [], msgInput: '', vidSrc: 'youtube', videoId: media.id,
    library, resumeLibrary: resume, connectionStatus: 'connected',
    containerRef: { current: null }, vidRef: { current: null }, driveVideoRef: { current: null } };
  const roomView = render(<Room {...roomProps} isHost />);
  expect(screen.queryByRole('button', { name: 'Resume at 0:40' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Browse media' }));
  fireEvent.click(screen.getByRole('button', { name: 'Library', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Resume at 0:40' })); expect(resume).toHaveBeenCalledWith(entry);
  roomView.rerender(<Room {...roomProps} isHost={false} />);
  const memberResume = screen.getByRole('button', { name: 'Resume at 0:40' });
  expect(memberResume.disabled).toBe(true); fireEvent.click(memberResume);
  expect(resume).toHaveBeenCalledOnce();
});
it('restores a bookmark after remount and lets the user choose it without storing a room secret', async () => {
  const choose = vi.fn(); const view = render(<Library choose={choose} />);
  await act(async () => fireEvent.click(screen.getByText('Save progress')));
  expect(screen.getByText('Friday movie')).toBeTruthy(); view.unmount();
  render(<Library choose={choose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose Friday movie' }));
  expect(choose).toHaveBeenCalledWith(expect.objectContaining({ position: 40, source: 'youtube' }));
});
it('adds and removes wishlist items and clears history without removing saved wishlist entries', async () => {
  render(<Library />); fireEvent.click(screen.getByText('Save progress'));
  fireEvent.click(screen.getByRole('button', { name: 'Wishlist', exact: true }));
  fireEvent.change(screen.getByLabelText('Save a video link'), { target: { value: 'https://youtu.be/abcdefghijk' } });
  fireEvent.change(screen.getByLabelText('Video title (optional)'), { target: { value: 'Friday movie' } });
  await act(async () => fireEvent.submit(screen.getByRole('button', { name: 'Save to wishlist', exact: true }).closest('form')));
  fireEvent.click(screen.getByRole('button', { name: 'History', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear viewing history' }));
  expect(screen.queryByText('Friday movie')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Wishlist', exact: true }));
  expect(screen.getByText('Friday movie')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Friday movie from wishlist' }));
  expect(screen.queryByText('Friday movie')).toBeNull();
});
it('remains usable when browser storage is blocked and explains the persistence limit', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  render(<Library />); await act(async () => fireEvent.click(screen.getByText('Save progress')));
  expect(screen.getByText('Friday movie')).toBeTruthy();
  expect(screen.getByText(/Saved for this session only/)).toBeTruthy();
});
