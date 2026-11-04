import { movieSelection, readMoviePath } from './selection';
export function parseMovieRoomSelection(value, origin = globalThis.location?.origin) {
  let choice = value;
  if (typeof value === 'string') {
    try {
      const url = new URL(value, origin), base = new URL(origin), route = readMoviePath(url.pathname);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin || url.username || url.password || url.search || url.hash || route.invalidMovie || !route.movieWatching) return null;
      choice = { source: 'movie', kind: route.movieKind, id: route.movieId, season: route.movieSeason, episode: route.movieEpisode };
    } catch { return null; }
  }
  if (choice?.source !== 'movie') return null;
  const item = movieSelection(choice, true); if (!item) return null;
  return { source: 'movie', kind: item.kind, id: item.id, season: item.season, episode: item.episode,
    title: typeof choice.title === 'string' && choice.title.trim() ? choice.title.trim().slice(0, 120) : 'Movie or TV', position: 0 };
}
export function movieRoomFields(value) {
  const item = parseMovieRoomSelection(value); if (!item) throw new Error('Choose a valid movie or TV episode.');
  return { videoSource: 'movie', videoId: item.id, movieKind: item.kind, movieSeason: item.season, movieEpisode: item.episode, movieTitle: item.title };
}
export function movieRoomSelection(room) {
  return parseMovieRoomSelection({ source: room?.videoSource, id: room?.videoId, kind: room?.movieKind, season: room?.movieSeason, episode: room?.movieEpisode, title: room?.movieTitle });
}
export function movieRoomScope(room) {
  const item = movieRoomSelection(room);
  return !room?.id || room.isSharing || !item ? null : `${room.id}/movie/${item.kind}/${item.id}/${item.season}/${item.episode}/${room.mediaSelectionId || ''}`;
}
export function movieRoomProgress(room, adapter) {
  const item = movieRoomSelection(room);
  if (!item || !adapter || adapter.movieScope !== movieRoomScope(room) || !['PLAYING', 'PAUSED', 'ENDED'].includes(adapter.getState())) return null;
  const position = adapter.getCurrentTime(), duration = adapter.getDuration();
  if (!Number.isFinite(position) || position <= 0 || !Number.isFinite(duration) || duration <= 0 || duration > 604800 || position > duration + 2) return null;
  return { kind: item.kind, id: item.id, title: item.title, season: item.season, episode: item.episode,
    position: Math.min(position, duration), duration, completed: adapter.getState() === 'ENDED' };
}
