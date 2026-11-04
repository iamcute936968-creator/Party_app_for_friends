import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Home from '../../src/components/Home';

const item = { source: 'youtube', id: 'abcdefghijk', title: 'Friday movie', position: 40, duration: 100, lastWatchedAt: 1 };
const props = () => ({ username: 'Guest', roomId: '', setUsername: vi.fn(), setRoomId: vi.fn(), create: vi.fn(), join: vi.fn(),
  library: { items: [item], persistent: true }, chooseLibrary: vi.fn(),
  account: { user: null, pending: false, connectGoogle: vi.fn() } });
beforeEach(() => { window.history.replaceState(null, '', '/'); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

it('gives each task a destination and shows only room entry on the initial page', () => {
  render(<Home {...props()} />);
  const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(within(navigation).getAllByRole('link').map(link => link.textContent)).toEqual(['Watch Together', 'Movies', 'Anime', 'Library']);
  const accountLink = screen.getByRole('link', { name: 'Account', exact: true });
  expect(navigation.contains(accountLink)).toBe(false);
  expect(accountLink.classList.contains('home-account')).toBe(true);
  expect(screen.getByRole('link', { name: 'Watch Together', exact: true }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByLabelText('Your name')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Search titles' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Your viewing library' })).toBeNull();
});

it('places Manga inside the Anime destination without adding a crowded main navigation item', async () => {
  window.history.replaceState(null, '', '/manga/not-a-title');
  render(<Home {...props()} />);
  const main = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(within(main).getAllByRole('link')).toHaveLength(4);
  expect(within(main).getByRole('link', { name: 'Anime', exact: true }).getAttribute('aria-current')).toBe('page');
  const section = screen.getByRole('navigation', { name: 'Anime and manga' });
  expect(within(section).getByRole('link', { name: 'Manga' }).getAttribute('aria-current')).toBe('page');
  await screen.findByRole('heading', { name: 'Manga unavailable' });
});

it('opens movie deep links in Movies while preserving the four main destinations', async () => {
  window.history.replaceState(null, '', '/movies/movie/not-an-id');
  render(<Home {...props()} />);
  const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(within(navigation).getAllByRole('link')).toHaveLength(4);
  expect(within(navigation).getByRole('link', { name: 'Movies', exact: true }).getAttribute('aria-current')).toBe('page');
  await screen.findByRole('heading', { name: 'Title unavailable' });
});

it('opens saved anime from Library and unmounts the Anime destination on exit', async () => {
  const options = { ...props(), animeFavorites: { items: [{ id: '98444', title: 'Laid-Back Camp' }], persistent: true, status: 'guest', toggle: vi.fn() } };
  render(<Home {...options} />);
  fireEvent.click(screen.getByRole('link', { name: 'Library', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Wishlist', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Open Laid-Back Camp' }));
  expect(window.location.pathname).toBe('/anime/98444');
  await screen.findByRole('button', { name: 'Browse anime' });
  fireEvent.click(screen.getByRole('link', { name: 'Watch Together', exact: true }));
  expect(screen.queryByRole('button', { name: 'Browse anime', hidden: true })).toBeNull();
});

it('chooses from Library and returns to room entry with the chosen video intact', () => {
  const options = props(); const view = render(<Home {...options} />);
  fireEvent.click(screen.getByRole('link', { name: 'Library', exact: true }));
  expect(window.location.pathname).toBe('/library');
  expect(screen.queryByRole('button', { name: 'Create Room' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Choose Friday movie' }));
  expect(options.chooseLibrary).toHaveBeenCalledWith(item);
  expect(window.location.pathname).toBe('/');
  view.rerender(<Home {...options} selectedMedia={item} />);
  expect(screen.getByRole('status').textContent).toContain('Next room: Friday movie');
  expect(screen.getByRole('button', { name: 'Create Room' })).toBeTruthy();
});

it('supports direct Account visits, browser history, draft preservation and keyboard focus', () => {
  window.history.replaceState(null, '', '/account');
  render(<Home {...props()} />);
  expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Create Room' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Movies', exact: true }));
  expect(window.location.pathname).toBe('/movies');
  fireEvent.click(screen.getByRole('link', { name: 'Library', exact: true }));
  expect(window.location.pathname).toBe('/library');
  act(() => { window.history.replaceState(null, '', '/movies'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(document.activeElement).toBe(screen.getByRole('main'));
});

it('uses clean shareable links and preserves native modified-click behavior', () => {
  window.history.replaceState(null, '', '/?room=QA&s=private-test-secret');
  render(<Home {...props()} />);
  const link = screen.getByRole('link', { name: 'Library', exact: true });
  expect(link.getAttribute('href')).toBe('/library');
  let nativeClick;
  document.addEventListener('click', event => { nativeClick = !event.defaultPrevented; event.preventDefault(); }, { once: true });
  fireEvent.click(link, { ctrlKey: true });
  expect(nativeClick).toBe(true);
  expect(window.location.pathname).toBe('/');
  fireEvent.click(link);
  expect(window.location.href).not.toContain('private-test-secret');
});
