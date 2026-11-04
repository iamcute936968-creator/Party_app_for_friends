import { expect, it, vi } from 'vitest';
import { createMovieApi, normalizeMovie } from '../../src/movies/api';
const movie = { id: '10378', mediaKind: 'movie', title: 'Big Buck Bunny', description: 'An open film', genres: ['Animation'], cover: 'https://image.tmdb.org/t/p/w500/cover.jpg', seasons: [] };
it('normalizes movie metadata and drops unsafe images and extra source URLs', () => {
  expect(normalizeMovie(movie)).toMatchObject({ id: '10378', title: 'Big Buck Bunny', mediaKind: 'movie' });
  const safe = normalizeMovie({ ...movie, cover: 'https://evil.example/image.jpg', sourceUrl: 'https://evil.example/private' });
  expect(safe.cover).toBe(''); expect(safe).not.toHaveProperty('sourceUrl');
  expect(normalizeMovie({ ...movie, id: '0' })).toBeNull();
});
it('uses the configured proxy for catalogue and bound season metadata', async () => {
  const fetchFn = vi.fn(async url => new Response(JSON.stringify(url.includes('/season/') ? { showId: '1399', number: 1, episodes: [{ id: '8', showId: '1399', number: 2, seasonNumber: 1, title: 'An episode' }] } : { items: [movie], pageInfo: { page: 1, hasNextPage: false } }), { headers: { 'content-type': 'application/json' } }));
  const api = createMovieApi({ proxyUrl: 'https://proxy.example', fetchFn });
  expect((await api.list({ kind: 'movie', search: 'Bunny' })).items[0].id).toBe('10378');
  expect(fetchFn.mock.calls[0][0]).toContain('/api/movies?');
  expect((await api.season('1399', 1)).episodes[0]).toMatchObject({ showId: '1399', number: 2 });
});
it('sends bounded discover filters and rejects invalid filter values locally', async () => {
  const fetchFn = vi.fn(async () => new Response(JSON.stringify({ items: [movie], pageInfo: { page: 1, hasNextPage: false } }), { headers: { 'content-type': 'application/json' } }));
  const api = createMovieApi({ proxyUrl: 'https://proxy.example', fetchFn });
  await api.list({ kind: 'movie', language: 'hi', genre: 16 });
  const url = String(fetchFn.mock.calls[0][0]);
  expect(url).toContain('language=hi'); expect(url).toContain('genre=16');
  await api.list({ kind: 'tv', sort: 'popular' });
  expect(String(fetchFn.mock.calls[1][0])).not.toContain('language=');
  for (const input of [{ language: 'zz' }, { language: 'hi-IN' }, { genre: '16' }, { genre: 17 }, { genre: 1.5 }, { language: 'hi', sort: 'trending' }]) await expect(api.list(input)).rejects.toThrow();
  expect(fetchFn.mock.calls.length).toBe(2);
});
