import { useEffect, useState } from 'react';
import { moviePath, readMoviePath } from '../movies/selection';

export const HOME_PAGES = [
  { id: 'watch', path: '/', label: 'Watch Together' },
  { id: 'movies', path: '/movies', label: 'Movies' },
  { id: 'anime', path: '/anime', label: 'Anime' },
  { id: 'manga', path: '/manga', label: 'Manga', inNavigation: false },
  { id: 'library', path: '/library', label: 'Library' },
  { id: 'account', path: '/account', label: 'Account', inNavigation: false },
];

export const homePageForPath = path => path === '/movies' || path?.startsWith('/movies/') ? 'movies' : path === '/manga' || path?.startsWith('/manga/') ? 'manga' : path === '/anime' || path?.startsWith('/anime/') ? 'anime' : path === '/discover' || path?.startsWith('/discover/') ? 'movies' : HOME_PAGES.find(page => page.path === path?.replace(/\/$/, '') ||
  (page.id === 'watch' && path === '/'))?.id || 'watch';

const validId = value => (/^[1-9][0-9]{0,9}$/.test(String(value)) && Number(value) <= 2147483647) || /^ap_[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(String(value));
function readLocation() {
  const path = window.location.pathname;
  const page = homePageForPath(path);
  if (page === 'movies') return readMoviePath(path);
  if (page === 'manga') {
    const match = /^\/manga(?:\/([a-f0-9-]{36})(?:\/read\/([a-f0-9-]{36}))?)?\/?$/.exec(path);
    const uuid = value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
    if (!match || (match[1] && !uuid(match[1])) || (match[2] && !uuid(match[2]))) return { page, mangaId: null, chapterId: null, invalidManga: true };
    return { page, mangaId: match[1] || null, chapterId: match[2] || null, invalidManga: false };
  }
  if (page !== 'anime' || /^\/anime\/?$/.test(path)) return { page, animeId: null, episode: null, invalidAnime: false };
  const match = /^\/anime\/([A-Za-z0-9_-]{1,123})(?:\/watch\/([1-9][0-9]{0,3}))?\/?$/.exec(path);
  if (!match || !validId(match[1])) return { page, animeId: null, episode: null, invalidAnime: true };
  return { page, animeId: match[1], episode: match[2] ? Number(match[2]) : null, invalidAnime: false };
}

export function useHomeNavigation() {
  const [location, setLocation] = useState(readLocation);
  useEffect(() => {
    const update = () => setLocation(readLocation());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  const navigate = (id, animeId = null, episode = null) => {
    const target = HOME_PAGES.find(page => page.id === id);
    if (!target) return false;
    let path = target.path;
    if (id === 'movies') { path = moviePath(animeId); if (!path) return false; }
    if (id === 'anime' && animeId !== null) {
      if (!validId(animeId) || (episode !== null && (!Number.isInteger(episode) || episode < 1 || episode > 9999))) return false;
      path += `/${animeId}${episode !== null ? `/watch/${episode}` : ''}`;
    }
    if (id === 'manga' && animeId !== null) {
      const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
      if (!uuid(animeId) || (episode !== null && !uuid(episode))) return false;
      path += `/${animeId}${episode !== null ? `/read/${episode}` : ''}`;
    }
    if (window.location.pathname + window.location.search + window.location.hash !== path) {
      window.history.pushState(null, '', path);
    }
    setLocation(readLocation());
    return true;
  };
  return { ...location, navigate };
}
