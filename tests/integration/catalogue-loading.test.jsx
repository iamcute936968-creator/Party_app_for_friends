import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AnimePage from '../../src/components/AnimePage';
import MoviesPage from '../../src/components/MoviesPage';
vi.mock('../../src/movies/retry', () => ({ retryDelayMs: attempt => (Number.isInteger(attempt) && attempt >= 0 && attempt < 8 ? 0 : -1) }));
import MangaPage from '../../src/components/MangaPage';
afterEach(cleanup);
const item = { id: '10378', title: 'A story', genres: [], links: [], episodes: [], authors: [], seasons: [], mediaKind: 'movie', cover: '' };
for (const [name, Page] of [['Anime', AnimePage], ['Movies', MoviesPage], ['Manga', MangaPage]]) {
  it(`${name} replaces its loading skeleton with content after the request resolves`, async () => {
    const pending = []; const api = { list: query => new Promise(resolve => { pending.push({ query, resolve }); }), coverUrl: () => '' };
    const view = render(<Page api={api} />);
    expect(view.container.querySelector('.loading-skeleton, .movie-rail-skeleton')).toBeTruthy();
    expect(screen.queryByText(/No titles found|No matching anime found|No manga found/)).toBeNull();
    await act(async () => pending.forEach(({ query, resolve }) => resolve({ items: [name === 'Movies' && query && !(query.language === 'en') && (query.language || query.genre || query.sort) ? { ...item, id: `v${query.language || query.genre || query.sort}`, title: `A story ${query.language || query.genre || query.sort}` } : item], pageInfo: { page: 1, hasNextPage: false } })));
    expect(screen.getByRole('button', { name: 'Details for A story' })).toBeTruthy();
    expect(view.container.querySelector('.loading-skeleton, .movie-rail-skeleton')).toBeNull();
  });
}
it('replaces a failed skeleton with an actionable error and shows it again during retry', { timeout: 30000 }, async () => {
  let fail; const api = { list: vi.fn(() => new Promise((_, reject) => { fail = reject; })) };
  const view = render(<MoviesPage api={api} />);
  fireEvent.change(screen.getByPlaceholderText('Search movies'), { target: { value: 'Naruto' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search titles' }));
  await waitFor(() => expect(view.container.querySelector('.loading-skeleton')).toBeTruthy());
  const gridCalls = () => api.list.mock.calls.filter(([query]) => query.search === 'Naruto').length;
  // Eight automatic retries (zero-delay mock schedule), then the actionable error.
  for (const expected of [2, 3, 4, 5, 6, 7, 8, 9]) {
    await act(async () => fail(Error('provider unavailable')));
    await waitFor(() => expect(gridCalls()).toBe(expected), { timeout: 4000 });
    expect(view.container.querySelector('.loading-skeleton')).toBeTruthy();
  }
  await act(async () => fail(Error('provider unavailable')));
  expect(view.container.querySelector('.loading-skeleton')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(view.container.querySelector('.loading-skeleton')).toBeTruthy();
  expect(gridCalls()).toBe(10);
});
