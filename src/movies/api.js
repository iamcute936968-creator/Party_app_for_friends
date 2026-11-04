import { createAnimeRequest } from '../anime/api';
import { validMovieId } from './selection';
const text = (value, max = 300) => typeof value === 'string' ? Array.from(value.slice(0, max).replace(/<[^>]*>/g, '')).filter(char => char.charCodeAt(0) !== 127 && (char.charCodeAt(0) >= 32 || [9, 10, 13].includes(char.charCodeAt(0)))).join('').trim() : '';
const image = value => typeof value === 'string' && /^https:\/\/image\.tmdb\.org\/t\/p\/(?:w[0-9]{2,4}|original)\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(value) ? value : '';
const fail = () => new Error('Movies and TV are temporarily unavailable. Please try again.');
// Bounded discover selectors, mirroring the media-proxy allowlists.
const LANGUAGES = new Set(['en', 'hi', 'ta', 'te', 'ml', 'kn', 'bn', 'ko', 'ja']);
const GENRES = new Set([28, 35, 18, 27, 878, 16, 99, 10751, 80, 14, 9648, 10749, 53]);
export function normalizeMovie(value) {
  if (!value || !validMovieId(value.id) || !['movie', 'tv'].includes(value.mediaKind) || !text(value.title)) return null;
  return { id: value.id, mediaKind: value.mediaKind, title: text(value.title), description: text(value.description, 12000), cover: image(value.cover), banner: image(value.banner),
    year: Number.isInteger(value.year) ? value.year : null, score: Number.isFinite(value.score) && value.score >= 0 && value.score <= 10 ? value.score : null,
    runtime: Number.isInteger(value.runtime) && value.runtime > 0 ? value.runtime : null, genres: (Array.isArray(value.genres) ? value.genres : []).slice(0, 30).map(value => text(value, 60)).filter(Boolean),
    externalIds: { imdb: /^tt[0-9]{5,12}$/.test(value.externalIds?.imdb || '') ? value.externalIds.imdb : '' },
    seasons: (Array.isArray(value.seasons) ? value.seasons : []).slice(0, 100).filter(s => Number.isInteger(s?.number) && s.number >= 0 && s.number <= 9999).map(s => ({ number: s.number, name: text(s.name, 120) || `Season ${s.number}`, episodeCount: Number.isInteger(s.episodeCount) && s.episodeCount > 0 ? s.episodeCount : 0, airDate: text(s.airDate, 10) })) };
}
export function createMovieApi(options = {}) {
  const transport = createAnimeRequest({ cacheMetadata: true, ...options });
  const request = async (path, signal) => { try { return await transport(path, signal); } catch (error) { if (error?.name === 'AbortError') throw error; throw fail(); } };
  return {
    list: async ({ kind = 'movie', search = '', page = 1, sort = 'popular', language = '', genre = 0 } = {}, { signal } = {}) => {
      if (!['movie', 'tv'].includes(kind) || typeof search !== 'string' || search.length > 80 || !Number.isInteger(page) || page < 1 || page > 50 || !['popular', 'trending', 'top-rated'].includes(sort)) throw fail();
      const filterLanguage = typeof language === 'string' && LANGUAGES.has(language) ? language : '';
      if (language !== '' && language !== filterLanguage) throw fail();
      const filterGenre = Number.isInteger(genre) && GENRES.has(genre) ? genre : 0;
      if (genre !== 0 && genre !== filterGenre) throw fail();
      if (sort === 'trending' && (filterLanguage || filterGenre)) throw fail();
      const params = { kind, search: search.trim(), page: String(page), sort };
      if (filterLanguage) params.language = filterLanguage;
      if (filterGenre) params.genre = String(filterGenre);
      const value = await request(`/api/movies?${new URLSearchParams(params)}`, signal);
      if (!Array.isArray(value.items)) throw fail();
      return { items: value.items.slice(0, 20).map(normalizeMovie).filter(item => item && item.mediaKind === kind), pageInfo: { page, hasNextPage: page < 50 && value.pageInfo?.hasNextPage === true } };
    },
    details: async (kind, id, { signal } = {}) => {
      if (!['movie', 'tv'].includes(kind) || !validMovieId(id)) throw fail();
      const item = normalizeMovie(await request(`/api/movies/${kind}/${id}`, signal)); if (!item || item.mediaKind !== kind || item.id !== id) throw fail(); return item;
    },
    season: async (id, number, { signal } = {}) => {
      if (!validMovieId(id) || !Number.isInteger(number) || number < 0 || number > 9999) throw fail();
      const value = await request(`/api/movies/tv/${id}/season/${number}`, signal);
      if (value.showId !== id || value.number !== number || !Array.isArray(value.episodes)) throw fail();
      const seen = new Set();
      return { showId: id, number, episodes: value.episodes.slice(0, 1000).filter(ep => validMovieId(ep?.id) && ep.showId === id && ep.seasonNumber === number && Number.isInteger(ep.number) && ep.number > 0 && ep.number <= 9999)
        .map(ep => ({ id: ep.id, showId: id, number: ep.number, seasonNumber: number, title: text(ep.title), description: text(ep.description, 5000), still: image(ep.still), airDate: text(ep.airDate, 10) }))
        .filter(ep => { if (seen.has(ep.number)) return false; seen.add(ep.number); return true; }).sort((a, b) => a.number - b.number) };
    },
  };
}
