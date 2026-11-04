export const validMovieId = value => typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value) && Number(value) <= 2147483647;
const index = (value, min = 0) => Number.isInteger(value) && value >= min && value <= 9999;
export function movieSelection(value, watch = value?.watch === true) {
  if (!value || !['movie', 'tv'].includes(value.kind) || !validMovieId(value.id)) return null;
  if (watch && value.kind === 'tv' && (!index(value.season) || !index(value.episode, 1))) return null;
  return { kind: value.kind, id: value.id, watch, season: value.kind === 'tv' && watch ? value.season : 0, episode: value.kind === 'tv' && watch ? value.episode : 0 };
}
export function moviePath(value = null) {
  if (!value || (!value.id && ['movie', 'tv'].includes(value.kind))) return value?.kind === 'tv' ? '/movies/tv' : '/movies';
  const item = movieSelection(value); if (!item) return null;
  return `/movies/${item.kind}/${item.id}${item.watch ? `/watch${item.kind === 'tv' ? `/${item.season}/${item.episode}` : ''}` : ''}`;
}
export function readMoviePath(path) {
  const empty = { page: 'movies', movieKind: 'movie', movieId: null, movieWatching: false, movieSeason: null, movieEpisode: null, invalidMovie: true };
  const match = /^\/movies(?:\/(movie|tv)(?:\/([1-9][0-9]{0,9})(?:\/(watch)(?:\/(0|[1-9][0-9]{0,3})\/([1-9][0-9]{0,3}))?)?)?)?\/?$/.exec(path);
  if (!match || (match[2] && !validMovieId(match[2])) || (match[3] && match[1] === 'tv' && !match[4]) || (match[1] === 'movie' && match[4])) return empty;
  return { ...empty, movieKind: match[1] || 'movie', movieId: match[2] || null, movieWatching: Boolean(match[3]), movieSeason: match[4] ? Number(match[4]) : null, movieEpisode: match[5] ? Number(match[5]) : null, invalidMovie: false };
}
export function movieEmbedUrl(value, position = 0) {
  const item = movieSelection(value, true); if (!item) return '';
  const query = new URLSearchParams();
  if (Number.isFinite(position) && position > 0 && position <= 604800) query.set('startAt', String(Math.floor(position)));
  return `https://vidsrc.sh/embed/${item.kind}/${item.id}${item.kind === 'tv' ? `/${item.season}/${item.episode}` : ''}${query.size ? `?${query}` : ''}`;
}
export function parseMoviePlayerEvent(event, { frame, selection, imdb = '' }) {
  const item = movieSelection(selection, true);
  if (!item || !frame || event.source !== frame || (event.origin !== 'https://vidsrc.sh' && event.origin !== 'https://cinesrc.st')) return null;
  let payload = event.data;
  if (typeof payload === 'string') { if (payload.length > 16000) return null; try { payload = JSON.parse(payload); } catch { return null; } }
  if (payload?.type === 'MEDIA_NOT_FOUND') return { error: 'unavailable' };
  if (payload?.type !== 'PLAYER_EVENT') return null;
  const data = payload.data, info = data?.player_info;
  if (!info || info.mediaType !== item.kind || !['playing', 'paused', 'seeked', 'completed'].includes(data.player_status)) return null;
  const tmdb = info.tmdb == null ? '' : String(info.tmdb), imdbId = info.imdb == null ? '' : String(info.imdb);
  if ((tmdb && tmdb !== item.id) || (imdbId && imdb && imdbId !== imdb) || !(tmdb === item.id || (imdb && imdbId === imdb))) return null;
  if (item.kind === 'tv' && (info.season == null || info.episode == null || Number(info.season) !== item.season || Number(info.episode) !== item.episode)) return null;
  const position = data.player_progress, duration = data.player_duration;
  if (!Number.isFinite(position) || position < 0 || !Number.isFinite(duration) || duration <= 0 || duration > 604800 || position > duration + 2) return null;
  return { ...item, position: Math.min(position, duration), duration, status: data.player_status, completed: data.player_status === 'completed' };
}
