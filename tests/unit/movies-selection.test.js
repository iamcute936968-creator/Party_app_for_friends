import { expect, it } from 'vitest';
import { moviePath, readMoviePath, movieEmbedUrl, parseMoviePlayerEvent } from '../../src/movies/selection';
it('builds canonical movie and TV watch paths without accepting arbitrary URLs', () => {
  expect(moviePath({ kind: 'movie', id: '10378', watch: true })).toBe('/movies/movie/10378/watch');
  expect(moviePath({ kind: 'tv', id: '1399', season: 0, episode: 2, watch: true })).toBe('/movies/tv/1399/watch/0/2');
  expect(moviePath({ kind: 'movie', id: '../bad' })).toBeNull();
  expect(moviePath({ kind: 'tv', id: '1399', watch: true })).toBeNull();
  expect(movieEmbedUrl({ kind: 'movie', id: '10378' })).toBe('https://vidsrc.sh/embed/movie/10378');
  expect(movieEmbedUrl({ kind: 'tv', id: '1399', season: 1, episode: 2 }, 42)).toBe('https://vidsrc.sh/embed/tv/1399/1/2?startAt=42');
});
it('parses reloadable details, TV browse and watch routes and rejects malformed addresses', () => {
  expect(readMoviePath('/movies/tv')).toMatchObject({ movieKind: 'tv', movieId: null, invalidMovie: false });
  expect(readMoviePath('/movies/movie/10378/watch')).toMatchObject({ movieKind: 'movie', movieId: '10378', movieWatching: true });
  for (const path of ['/movies/tv/1399/watch', '/movies/movie/0', '/movies/movie/10378/watch/1/2']) expect(readMoviePath(path).invalidMovie).toBe(true);
});
it('accepts progress only from the selected player window, exact origin and matching title/episode', () => {
  const frame = {}, selection = { kind: 'tv', id: '1399', season: 1, episode: 2 }, data = { type: 'PLAYER_EVENT', data: { player_info: { tmdb: 1399, mediaType: 'tv', season: 1, episode: 2 }, player_status: 'playing', player_progress: 45, player_duration: 300 } };
  const event = { source: frame, origin: 'https://vidsrc.sh', data };
  expect(parseMoviePlayerEvent(event, { frame, selection })).toMatchObject({ position: 45, duration: 300, status: 'playing' });
  expect(parseMoviePlayerEvent({ ...event, source: {} }, { frame, selection })).toBeNull();
  expect(parseMoviePlayerEvent({ ...event, origin: 'https://other.example' }, { frame, selection })).toBeNull();
  expect(parseMoviePlayerEvent(event, { frame, selection: { ...selection, episode: 3 } })).toBeNull();
  expect(parseMoviePlayerEvent({ ...event, data: { ...data, data: { ...data.data, player_progress: Infinity } } }, { frame, selection })).toBeNull();
});
