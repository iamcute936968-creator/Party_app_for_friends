import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MoviesPage from '../../src/components/MoviesPage';
const item = { id: '10378', mediaKind: 'movie', title: 'Big Buck Bunny', genres: ['Animation'], seasons: [], description: 'An open film.' };
afterEach(cleanup);
it('offers only in-room actions when browsing without mounting a solo player', async () => {
  const together = vi.fn();
  render(<MoviesPage api={{ details: async () => item }} kind="movie" movieId="10378" roomBrowser onWatchTogether={together} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Play in room', exact: true }));
  expect(together).toHaveBeenCalledWith(expect.objectContaining({ source: 'movie', id: '10378' }));
  expect(screen.queryByRole('button', { name: 'Watch movie', exact: true })).toBeNull();
  expect(document.querySelector('iframe, video')).toBeNull();
});
it('offers an explicit movie room choice without replacing solo playback', async () => {
  const together = vi.fn();
  render(<MoviesPage api={{ details: async () => item }} kind="movie" movieId="10378" onWatchTogether={together} />);
  expect(await screen.findByRole('button', { name: 'Watch movie', exact: true })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Watch together', exact: true }));
  expect(together).toHaveBeenCalledWith({ source: 'movie', kind: 'movie', id: '10378', title: 'Big Buck Bunny', season: 0, episode: 0, position: 0 });
});
it('browses movie metadata and saves through an explicit wishlist button', async () => {
  const api = { list: vi.fn(async ({ language, genre, sort }) => ({ items: [language === 'hi' ? { ...item, id: '12259', title: 'Sholay' } : (language && language !== 'en') || genre ? { ...item, id: `9${language || genre}`, title: `Title ${language || genre}` } : sort === 'top-rated' ? { ...item, id: '550', title: 'Fight Club' } : item], pageInfo: { page: 1, hasNextPage: false } })) }, library = { items: [], status: 'guest', persistent: true, toggle: vi.fn() }, navigate = vi.fn();
  render(<MoviesPage api={api} library={library} navigate={navigate} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add Big Buck Bunny to wishlist' })); await waitFor(() => expect(library.toggle).toHaveBeenCalledWith({ kind: 'movie', id: '10378', title: 'Big Buck Bunny' }));
  fireEvent.click(screen.getByRole('button', { name: 'Details for Big Buck Bunny' })); expect(navigate).toHaveBeenCalledWith('movies', { kind: 'movie', id: '10378' });
});
it('lists real TV episodes and starts the selected season/episode', async () => {
  const tv = { ...item, id: '1399', mediaKind: 'tv', title: 'A show', seasons: [{ number: 1, name: 'Season 1', episodeCount: 2 }] }, navigate = vi.fn();
  const api = { details: async () => tv, season: async () => ({ showId: '1399', number: 1, episodes: [{ id: '1', number: 1, seasonNumber: 1, showId: '1399', title: 'The beginning' }] }) };
  render(<MoviesPage api={api} kind="tv" movieId="1399" navigate={navigate} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Watch episode 1' })); expect(navigate).toHaveBeenCalledWith('movies', { kind: 'tv', id: '1399', watch: true, season: 1, episode: 1 });
});
it('chooses the exact TV season and episode for a synchronized room', async () => {
  const together = vi.fn(), tv = { ...item, id: '1399', mediaKind: 'tv', seasons: [{ number: 1, name: 'Season 1' }] };
  render(<MoviesPage api={{ details: async () => tv, season: async () => ({ showId: '1399', number: 1, episodes: [{ id: '2', number: 2, title: 'Second' }] }) }} kind="tv" movieId="1399" onWatchTogether={together} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Watch episode 2 together', exact: true }));
  expect(together).toHaveBeenCalledWith(expect.objectContaining({ source: 'movie', kind: 'tv', id: '1399', season: 1, episode: 2 }));
});
it('fails a missing TV episode before mounting a player', async () => {
  const tv = { ...item, id: '1399', mediaKind: 'tv', seasons: [{ number: 1, name: 'Season 1' }] };
  render(<MoviesPage api={{ details: async () => tv, season: async () => ({ showId: '1399', number: 1, episodes: [] }) }} kind="tv" movieId="1399" watching season={1} episode={2} />);
  expect((await screen.findByRole('alert')).textContent).toContain('episode'); expect(screen.queryByTitle('Big Buck Bunny player')).toBeNull();
});

it('exposes a stable Season label for choosing a different season', async () => {
  const tv = { ...item, id: '1399', mediaKind: 'tv', seasons: [{ number: 1, name: 'Season 1' }, { number: 2, name: 'Season 2' }] }, api = { details: async () => tv, season: vi.fn(async (_id, number) => ({ showId: '1399', number, episodes: [] })) };
  render(<MoviesPage api={api} kind="tv" movieId="1399" />);
  fireEvent.change(await screen.findByLabelText('Season', { exact: true }), { target: { value: '2' } });
  await waitFor(() => expect(api.season).toHaveBeenCalledWith('1399', 2, expect.any(Object)));
});

it('renders organized season pills, episode navigator grid, and selected episode card for TV series', async () => {
  const tv = {
    ...item,
    id: '1399',
    mediaKind: 'tv',
    title: 'Game of Thrones',
    seasons: [
      { number: 1, name: 'Season 1', episodeCount: 2 },
      { number: 2, name: 'Season 2', episodeCount: 2 }
    ]
  };
  const episodesS1 = [
    { id: '101', number: 1, seasonNumber: 1, showId: '1399', title: 'Winter Is Coming', description: 'Ned Stark is torn between his family and Robert Baratheon.', airDate: '2011-04-17' },
    { id: '102', number: 2, seasonNumber: 1, showId: '1399', title: 'The Kingsroad', description: 'Bran recovers from his fall.', airDate: '2011-04-24' }
  ];
  const episodesS2 = [
    { id: '201', number: 1, seasonNumber: 2, showId: '1399', title: 'The North Remembers', description: 'Tyrion arrives at King Landing.', airDate: '2012-04-01' }
  ];
  const api = {
    details: async () => tv,
    season: vi.fn(async (_id, num) => ({ showId: '1399', number: num, episodes: num === 2 ? episodesS2 : episodesS1 }))
  };
  const together = vi.fn();
  const navigate = vi.fn();

  render(<MoviesPage api={api} kind="tv" movieId="1399" navigate={navigate} onWatchTogether={together} />);

  // Should render season pills
  const seasonPill1 = await screen.findByRole('button', { name: 'Season 1' });
  const seasonPill2 = screen.getByRole('button', { name: 'Season 2' });
  expect(seasonPill1.getAttribute('aria-pressed')).toBe('true');
  expect(seasonPill2.getAttribute('aria-pressed')).toBe('false');

  // Should render EpisodeNavigator toolbar & grid
  expect(await screen.findByRole('group', { name: 'Episode navigation' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Previous episode' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Next episode' })).toBeTruthy();
  expect(screen.getByLabelText('Episode range')).toBeTruthy();

  // Active episode card should show episode 1 details
  expect(await screen.findByText('Winter Is Coming', { exact: false })).toBeTruthy();
  expect(screen.getByText('Ned Stark is torn between his family and Robert Baratheon.')).toBeTruthy();
  expect(screen.getByText('2011-04-17')).toBeTruthy();

  // Clicking Season 2 pill should load Season 2
  fireEvent.click(seasonPill2);
  await waitFor(() => expect(api.season).toHaveBeenCalledWith('1399', 2, expect.any(Object)));
  expect(await screen.findByText('The North Remembers', { exact: false })).toBeTruthy();
});

it('renders a cinema hero and regional browse rows that each query their own collection', async () => {
  const korean = { ...item, id: '62639', title: 'Train to Busan' }, animated = { ...item, id: '508947', title: 'Turning Red' };
  const api = { list: vi.fn(async ({ language, genre }) => ({ items: [language === 'ko' ? korean : genre === 16 ? animated : item], pageInfo: { page: 1, hasNextPage: false } })) };
  const navigate = vi.fn();
  render(<MoviesPage api={api} library={{ items: [], status: 'guest', persistent: true, toggle: vi.fn() }} navigate={navigate} />);
  expect(await screen.findByRole('button', { name: 'Play Big Buck Bunny' })).toBeTruthy();
  for (const name of ['Trending Now', 'Korean', 'Animated Films']) expect(screen.getByRole('region', { name })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Bollywood' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Top Rated' })).toBeNull();
  expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ kind: 'movie', language: 'en' }), expect.anything());
  expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ kind: 'movie', language: 'ko' }), expect.anything());
  expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ kind: 'movie', genre: 16 }), expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Details for Train to Busan' }));
  expect(navigate).toHaveBeenCalledWith('movies', { kind: 'movie', id: '62639' });
});

it('rotates the featured hero through the trending titles automatically', async () => {
  vi.useFakeTimers();
  try {
    const second = { ...item, id: '603', title: 'The Matrix' };
    const api = { list: vi.fn(async () => ({ items: [item, second], pageInfo: { page: 1, hasNextPage: false } })) };
    render(<MoviesPage api={api} library={{ items: [], status: 'guest', persistent: true, toggle: vi.fn() }} navigate={vi.fn()} />);
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Play Big Buck Bunny' })).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(8500); });
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Play The Matrix' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Play Big Buck Bunny' })).toBeNull();
  } finally { vi.useRealTimers(); }
});

it('shows featured dots that jump between trending titles', async () => {
  const second = { ...item, id: '603', title: 'The Matrix' };
  const api = { list: vi.fn(async () => ({ items: [item, second], pageInfo: { page: 1, hasNextPage: false } })) };
  render(<MoviesPage api={api} library={{ items: [], status: 'guest', persistent: true, toggle: vi.fn() }} navigate={vi.fn()} />);
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'Featured title 1: Big Buck Bunny' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Featured title 2: The Matrix' }));
  expect(screen.getByRole('button', { name: 'Play The Matrix' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Featured title 2: The Matrix' }).getAttribute('aria-pressed')).toBe('true');
});

it('shows a catalogue-unavailable notice when every row fails', async () => {
  const api = { list: vi.fn(async () => { throw Error('down'); }) };
  render(<MoviesPage api={api} library={{ items: [], status: 'guest', persistent: true, toggle: vi.fn() }} navigate={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 6000 });
  expect(screen.getByRole('alert').textContent).toContain('could not be reached');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

it('offers row arrow buttons that scroll the rail like a streaming carousel', async () => {
  const api = { list: vi.fn(async () => ({ items: [item], pageInfo: { page: 1, hasNextPage: false } })) };
  render(<MoviesPage api={api} library={{ items: [], status: 'guest', persistent: true, toggle: vi.fn() }} navigate={vi.fn()} />);
  await screen.findByRole('region', { name: 'Trending Now' });
  const right = screen.getByRole('button', { name: 'Scroll Trending Now right' });
  const left = screen.getByRole('button', { name: 'Scroll Trending Now left' });
  fireEvent.click(right); fireEvent.click(left);
  expect(right).toBeTruthy();
});

it('swaps the browse row collections when browsing TV series instead of movies', async () => {
  const api = { list: vi.fn(async () => ({ items: [item], pageInfo: { page: 1, hasNextPage: false } })) };
  render(<MoviesPage api={api} library={{ items: [], status: 'guest', persistent: true, toggle: vi.fn() }} navigate={vi.fn()} kind="tv" />);
  await screen.findByRole('region', { name: 'K-Drama' });
  for (const name of ['Trending Now', 'K-Drama', 'Anime Series']) expect(screen.getByRole('region', { name })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Bollywood' })).toBeNull();
  expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tv', language: 'ko' }), expect.anything());
  expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tv', genre: 16 }), expect.anything());
});

it('shows a lettered fallback tile when a rail title has no poster image', async () => {
  const noCover = { ...item, cover: '' };
  const api = { list: vi.fn(async () => ({ items: [noCover], pageInfo: { page: 1, hasNextPage: false } })) };
  render(<MoviesPage api={api} library={{ items: [], status: 'guest', persistent: true, toggle: vi.fn() }} navigate={vi.fn()} />);
  const tiles = await screen.findAllByText('B', { selector: '.movie-rail-fallback' });
  expect(tiles.length).toBeGreaterThan(0);
  const cards = await screen.findAllByRole('button', { name: 'Details for Big Buck Bunny' });
  expect(cards.length).toBeGreaterThan(0);
});

it('retries a failed details load once automatically before showing the error', async () => {
  let calls = 0;
  const tv = { ...item, id: '1399', mediaKind: 'tv', title: 'A story', seasons: [{ number: 1, name: 'Season 1' }] };
  const api = { details: vi.fn(async () => { calls++; if (calls === 1) throw Error('flaky'); return tv; }) };
  render(<MoviesPage api={api} kind="tv" movieId="1399" />);
  await waitFor(() => expect(screen.getByRole('heading', { name: 'A story' })).toBeTruthy(), { timeout: 4000 });
  expect(api.details).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});
it('retries a failed browse row automatically so the rail still renders', async () => {
  let failedKorean = false;
  const train = { ...item, id: '62639', title: 'Train to Busan' };
  const api = { list: vi.fn(async query => {
    if (query?.language === 'ko' && !failedKorean) { failedKorean = true; throw Error('flaky'); }
    return { items: [query?.language === 'ko' ? train : item], pageInfo: { page: 1, hasNextPage: false } };
  }) };
  render(<MoviesPage api={api} library={{ items: [], status: 'guest', persistent: true, toggle: vi.fn() }} navigate={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('region', { name: 'Korean' })).toBeTruthy(), { timeout: 5000 });
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Details for Train to Busan' }).length).toBeGreaterThan(0), { timeout: 5000 });
});
it('filters into a grid by language or genre and returns to rows when cleared', async () => {
  const api = { list: vi.fn(async () => ({ items: [item], pageInfo: { page: 1, hasNextPage: false } })) };
  render(<MoviesPage api={api} library={{ items: [], status: 'guest', persistent: true, toggle: vi.fn() }} navigate={vi.fn()} />);
  await screen.findByRole('region', { name: 'Trending Now' });
  fireEvent.change(screen.getByLabelText('Language', { exact: true }), { target: { value: 'hi' } });
  await waitFor(() => expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ language: 'hi' }), expect.anything()));
  expect(await screen.findByRole('button', { name: 'Details for Big Buck Bunny' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Trending Now' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Language', { exact: true }), { target: { value: '' } });
  expect(await screen.findByRole('region', { name: 'Trending Now' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Genre', { exact: true }), { target: { value: '16' } });
  await waitFor(() => expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ genre: 16 }), expect.anything()));
  expect(screen.queryByRole('region', { name: 'Trending Now' })).toBeNull();
});
