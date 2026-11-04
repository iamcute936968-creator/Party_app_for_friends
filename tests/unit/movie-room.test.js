import { expect, it } from 'vitest';
import { movieRoomFields, movieRoomScope, parseMovieRoomSelection, movieRoomSelection, movieRoomProgress } from '../../src/movies/room';
import { updateMovieLibrary } from '../../src/movies/library';
import { cineSrcEmbedUrl } from '../../src/adapters/CineSrcAdapter';
it('accepts canonical movie and TV choices and only this app’s watch addresses', () => {
  const item = { source: 'movie', kind: 'movie', id: '10378', title: 'Big Buck Bunny' };
  expect(parseMovieRoomSelection(item)).toEqual({ ...item, season: 0, episode: 0, position: 0 });
  expect(parseMovieRoomSelection('https://party.example/movies/tv/1399/watch/0/2', 'https://party.example')).toMatchObject({ kind: 'tv', id: '1399', season: 0, episode: 2 });
  for (const bad of [{ ...item, id: '../bad' }, { ...item, kind: 'tv', season: 1, episode: 0 }, { ...item, kind: 'tv', season: 1.2, episode: 2 },
    'https://other.example/movies/movie/10378/watch', 'https://party.example/movies/movie/10378/watch?secret=bad', 'https://party.example/movies/movie/10378']) expect(parseMovieRoomSelection(bad, 'https://party.example')).toBeNull();
});
it('saves only complete, scoped movie progress accepted by the existing guest library', () => {
  const room = { ...movieRoomFields({ source: 'movie', kind: 'movie', id: '10378', title: 'Big Buck Bunny' }), id: 'ROOM', mediaSelectionId: 'first' };
  const adapter = { movieScope: movieRoomScope(room), getState: () => 'PLAYING', getCurrentTime: () => 5, getDuration: () => NaN };
  // Providers can report time before metadata. Such a record throws in the guest state updater.
  expect(() => updateMovieLibrary([], 'record', { kind: 'movie', id: '10378', title: room.movieTitle, position: 5, duration: NaN })).toThrow();
  expect(movieRoomProgress(room, adapter)).toBeNull();
  adapter.getDuration = () => 600; const progress = movieRoomProgress(room, adapter);
  expect(updateMovieLibrary([], 'record', progress)).toHaveLength(1);
  adapter.getCurrentTime = () => 601; expect(movieRoomProgress(room, adapter).position).toBe(600);
  adapter.getCurrentTime = () => 604; expect(movieRoomProgress(room, adapter)).toBeNull();
  adapter.movieScope = 'retired'; expect(movieRoomProgress(room, adapter)).toBeNull();
});
it('stores only bounded metadata and changes scope for every title, episode and selection', () => {
  const fields = movieRoomFields({ source: 'movie', kind: 'tv', id: '1399', season: 1, episode: 2, title: 'A show', sourceUrl: 'private' });
  expect(fields).toEqual({ videoSource: 'movie', videoId: '1399', movieKind: 'tv', movieSeason: 1, movieEpisode: 2, movieTitle: 'A show' });
  const room = { ...fields, id: 'ROOM', mediaSelectionId: 'first' };
  expect(movieRoomSelection(room)).toMatchObject({ kind: 'tv', season: 1, episode: 2 });
  for (const next of [{ ...room, movieEpisode: 3 }, { ...room, mediaSelectionId: 'second' }, { ...room, videoId: '100' }]) expect(movieRoomScope(next)).not.toBe(movieRoomScope(room));
  expect(movieRoomScope({ ...room, isSharing: true })).toBeNull();
  const url = new URL(cineSrcEmbedUrl(movieRoomSelection(room)));
  expect(url.origin).toBe('https://cinesrc.st'); expect(url.pathname).toBe('/embed/tv/1399');
  expect(url.searchParams.get('s')).toBe('1'); expect(url.searchParams.get('e')).toBe('2'); expect(url.searchParams.get('autonext')).toBe('false');
});
