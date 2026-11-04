import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MoviePlayer from '../../src/components/MoviePlayer';
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('loads the selected source, records matching progress and rejects wrong windows or title IDs', async () => {
  const item = { id: '10378', mediaKind: 'movie', title: 'Big Buck Bunny', externalIds: { imdb: 'tt1254207' } }, library = { items: [], status: 'guest', record: vi.fn() };
  render(<MoviePlayer item={item} selection={{ kind: 'movie', id: '10378' }} library={library} />);
  const frame = screen.getByTitle('Big Buck Bunny player'); expect(frame.getAttribute('src')).toContain('/embed/movie/10378'); expect(library.record).not.toHaveBeenCalled();
  const data = { type: 'PLAYER_EVENT', data: { player_info: { tmdb: 10378, mediaType: 'movie' }, player_status: 'playing', player_progress: 12, player_duration: 300 } };
  fireEvent(window, new MessageEvent('message', { source: {}, origin: 'https://vidsrc.sh', data })); expect(library.record).not.toHaveBeenCalled();
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: 'https://vidsrc.sh', data }));
  await waitFor(() => expect(library.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'movie', id: '10378', position: 12 })));
});
it('resumes from confirmed saved progress and gives an explicit retry for a reported missing title', () => {
  render(<MoviePlayer item={{ id: '10378', mediaKind: 'movie', title: 'Bunny' }} selection={{ kind: 'movie', id: '10378' }} library={{ items: [{ kind: 'movie', id: '10378', position: 42, completed: false }], status: 'guest' }} />);
  const frame = screen.getByTitle('Bunny player'); expect(frame.getAttribute('src')).toContain('startAt=42');
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: 'https://vidsrc.sh', data: { type: 'MEDIA_NOT_FOUND' } }));
  expect(screen.getByRole('alert').textContent).toContain('unavailable'); fireEvent.click(screen.getByRole('button', { name: 'Retry player' })); expect(screen.getByTitle('Bunny player')).toBeTruthy();
});

it('shows recovery guidance when a provider loads but never reports a usable player', async () => {
  vi.useFakeTimers();
  render(<MoviePlayer item={{ id: '10378', title: 'Bunny' }} selection={{ kind: 'movie', id: '10378' }} />);
  const frame = screen.getByTitle('Bunny player'); fireEvent.load(frame);
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(screen.getByText(/taking longer to respond/i)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reload player' }));
  expect(screen.queryByText(/taking longer to respond/i)).toBeNull();
});

it('clears slow-provider guidance only after a message from the selected player and title', async () => {
  vi.useFakeTimers();
  render(<MoviePlayer item={{ id: '10378', title: 'Bunny' }} selection={{ kind: 'movie', id: '10378' }} />);
  const frame = screen.getByTitle('Bunny player'), data = { type: 'PLAYER_EVENT', data: { player_info: { tmdb: 10378, mediaType: 'movie' }, player_status: 'playing', player_progress: 4, player_duration: 597 } };
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  fireEvent(window, new MessageEvent('message', { source: {}, origin: 'https://vidsrc.sh', data }));
  expect(screen.getByText(/taking longer to respond/i)).toBeTruthy();
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: 'https://vidsrc.sh', data }));
  expect(screen.queryByText(/taking longer to respond/i)).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(screen.queryByText(/taking longer to respond/i)).toBeNull();
});

it('renders the movie player frame container with appropriate accessibility and frame classes', () => {
  const { container } = render(<MoviePlayer item={{ id: '791523', title: 'Wildwood' }} selection={{ kind: 'movie', id: '791523' }} />);
  const section = container.querySelector('.movie-player');
  expect(section).toBeTruthy();
  expect(section.getAttribute('aria-label')).toBe('Movie player');
  const frameContainer = container.querySelector('.movie-player-frame');
  expect(frameContainer).toBeTruthy();
  const iframe = frameContainer.querySelector('iframe');
  expect(iframe).toBeTruthy();
  expect(iframe.getAttribute('title')).toBe('Wildwood player');
});
