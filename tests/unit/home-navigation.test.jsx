import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { HOME_PAGES, homePageForPath, useHomeNavigation } from '../../src/hooks/useHomeNavigation';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

it('orders navigation with Movies before Anime, Watch Together first, and no Discover tab', () => {
  const visible = HOME_PAGES.filter(p => p.inNavigation !== false).map(p => p.id);
  expect(visible).toEqual(['watch', 'movies', 'anime', 'library']);
  expect(HOME_PAGES.find(p => p.id === 'discover')).toBeUndefined();
});

it.each([['/', 'watch'], ['/library', 'library'], ['/movies', 'movies'], ['/discover/', 'movies'], ['/account', 'account'],
  ['/anime', 'anime'], ['/anime/98444/watch/2', 'anime'],
  ['/unknown', 'watch'], ['//outside.example', 'watch']])('resolves %s to the supported page', (path, expected) => {
  expect(homePageForPath(path)).toBe(expected);
});

it('supports validated anime detail and episode routes without accepting unsafe IDs', () => {
  window.history.replaceState(null, '', '/anime/98444/watch/2');
  const { result } = renderHook(useHomeNavigation);
  expect(result.current).toMatchObject({ page: 'anime', animeId: '98444', episode: 2 });
  act(() => result.current.navigate('anime', '12189'));
  expect(window.location.pathname).toBe('/anime/12189');
  act(() => expect(result.current.navigate('anime', '../bad', 1)).toBe(false));
  expect(window.location.pathname).toBe('/anime/12189');
});

it('opens deep links and responds to browser history without losing the subscription', () => {
  window.history.replaceState(null, '', '/library');
  const view = renderHook(useHomeNavigation);
  expect(view.result.current.page).toBe('library');
  act(() => view.result.current.navigate('account'));
  expect(window.location.pathname).toBe('/account');
  act(() => { window.history.replaceState(null, '', '/movies'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(view.result.current.page).toBe('movies');
});

it('accepts namespaced provider slugs for reloadable anime and episode routes', () => {
  window.history.replaceState(null, '', '/anime/ap_naruto/watch/1');
  const { result } = renderHook(useHomeNavigation);
  expect(result.current).toMatchObject({ page: 'anime', animeId: 'ap_naruto', episode: 1, invalidAnime: false });
  act(() => result.current.navigate('anime', 'ap_sousou-no-frieren', 2));
  expect(window.location.pathname).toBe('/anime/ap_sousou-no-frieren/watch/2');
  act(() => expect(result.current.navigate('anime', 'ap_../bad')).toBe(false));
});

it('limits navigation to fixed same-origin routes and omits invite authorization', () => {
  window.history.replaceState(null, '', '/?room=QA&s=private-test-secret');
  const { result } = renderHook(useHomeNavigation);
  act(() => result.current.navigate('library'));
  expect(window.location.pathname + window.location.search + window.location.hash).toBe('/library');
  for (const target of ['https://outside.example', '//outside.example', '__proto__']) {
    act(() => expect(result.current.navigate(target)).toBe(false));
    expect(window.location.pathname).toBe('/library');
  }
});

it('opens canonical manga and chapter routes while keeping them in the anime section', () => {
  const id = '58be6aa6-06cb-4ca5-bd20-f1392ce451fb', chapter = 'ff4f79de-6102-4610-8327-539904cfe549';
  window.history.replaceState(null, '', `/manga/${id}/read/${chapter}`);
  const { result } = renderHook(useHomeNavigation); expect(result.current).toMatchObject({ page: 'manga', mangaId: id, chapterId: chapter, invalidManga: false });
  act(() => result.current.navigate('manga', id)); expect(window.location.pathname).toBe(`/manga/${id}`);
  act(() => expect(result.current.navigate('manga', '../bad')).toBe(false));
});

it('supports validated movie and TV details/watch routes while keeping existing destinations', () => {
  window.history.replaceState(null, '', '/movies/tv/1399/watch/1/2');
  const { result } = renderHook(useHomeNavigation);
  expect(result.current).toMatchObject({ page: 'movies', movieKind: 'tv', movieId: '1399', movieWatching: true, movieSeason: 1, movieEpisode: 2 });
  act(() => result.current.navigate('movies', { kind: 'movie', id: '10378', watch: true }));
  expect(window.location.pathname).toBe('/movies/movie/10378/watch');
  act(() => expect(result.current.navigate('movies', { kind: 'movie', id: '../bad' })).toBe(false));
});
