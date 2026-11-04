import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AnimePage from '../../src/components/AnimePage';

const title = { id: '98444', title: 'Laid-Back Camp', description: 'A camping story.', genres: ['Comedy'], score: 80,
  year: 2018, totalEpisodes: 12, cover: '', banner: '', trailerId: '', links: [],
  episodes: [{ id: '2C7Kp0yBpvo', number: 1, provider: 'Ani-One Asia', language: 'Traditional Chinese subtitles', embeddable: true }] };
const favorites = () => ({ items: [], status: 'guest', persistent: true, toggle: vi.fn(), guestItemCount: 0 });
const api = () => ({ list: vi.fn(async () => ({ items: [title], pageInfo: { page: 1, hasNextPage: false }, source: 'live' })), details: vi.fn(async () => title) });
afterEach(() => { cleanup(); delete window.YT; });
it('browses a long episode grid inside the room without mounting another player', async () => {
  const service = api(), together = vi.fn();
  service.details.mockResolvedValue({ ...title, id: 'ap_naruto', episodes: Array.from({ length: 220 }, (_, i) => ({ number: i + 1, embeddable: true, source: 'hls', language: 'Subtitled' })) });
  render(<AnimePage api={service} animeId="ap_naruto" roomBrowser favorites={favorites()} onWatchTogether={together} />);
  await screen.findByRole('heading', { name: title.title, level: 1 });
  fireEvent.change(screen.getByLabelText('Episode range'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Watch episode 220', exact: true }));
  expect(together).toHaveBeenCalledWith({ source: 'anime', id: 'ap_naruto', episode: 220, title: title.title, position: 0 });
  expect(document.querySelector('video, iframe')).toBeNull();
  expect(screen.getByRole('button', { name: 'Dub', exact: true }).disabled).toBe(true);
});
it('loads the expanded collection and opens a real title through validated navigation', async () => {
  const navigate = vi.fn(), service = api();
  render(<AnimePage api={service} navigate={navigate} favorites={favorites()} />);
  const button = await screen.findByRole('button', { name: 'Details for Laid-Back Camp' });
  expect(service.list.mock.calls[0][0].collection).toBe('all');
  fireEvent.click(button); expect(navigate).toHaveBeenCalledWith('anime', '98444');
});

it('shows accessible wishlist icons on provider discovery cards and hides unsupported sorting', async () => {
  const service = api(), saved = favorites();
  service.list.mockResolvedValue({ items: [{ ...title, id: 'ap_naruto', title: 'Naruto', provider: 'animeparadise', episodes: [] }], pageInfo: { page: 1, hasNextPage: false } });
  render(<AnimePage api={service} favorites={saved} discovery />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add Naruto to wishlist' }));
  await waitFor(() => expect(saved.toggle).toHaveBeenCalledWith({ id: 'ap_naruto', title: 'Naruto' }));
  expect(screen.queryByLabelText('Sort')).toBeNull();
  expect(screen.getByText(/AnimeParadise/)).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1 }).closest('.home-page')).toBeNull();
});
it('details show true source language, separate title saving and episode watching', async () => {
  const saved = favorites(), navigate = vi.fn();
  render(<AnimePage api={api()} animeId="98444" navigate={navigate} favorites={saved} />);
  await screen.findByRole('heading', { name: 'Laid-Back Camp', level: 1 });
  expect(screen.getByText('Traditional Chinese subtitles')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Watch episode 1', exact: true })[0]);
  expect(navigate).toHaveBeenCalledWith('anime', '98444', 1);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save anime', exact: true })));
  expect(saved.toggle).toHaveBeenCalledWith(expect.objectContaining({ id: '98444', title: 'Laid-Back Camp' }));
});
it('replaces obsolete requests and never publishes late details after navigation', async () => {
  let resolveFirst; const service = api();
  service.details.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
  const view = render(<AnimePage api={service} animeId="98444" favorites={favorites()} />);
  view.rerender(<AnimePage api={service} animeId="12189" favorites={favorites()} />);
  await screen.findByRole('heading', { name: 'Laid-Back Camp', level: 1 });
  await act(async () => resolveFirst({ ...title, title: 'Late old title' }));
  expect(screen.queryByText('Late old title')).toBeNull();
});
it('handles filtered or missing titles without starting a player', async () => {
  const service = api(); service.details.mockRejectedValue(Object.assign(Error(), { code: 'ANIME_NOT_FOUND' }));
  render(<AnimePage api={service} animeId="999999" favorites={favorites()} />);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not available'));
  expect(document.querySelector('iframe')).toBeNull();
});
it('keeps trailers separate from the active episode player', async () => {
  const service = api(); service.details.mockResolvedValue({ ...title, trailerId: 'vpH42sJ8t9c' });
  render(<AnimePage api={service} animeId="98444" episode={1} favorites={favorites()} />);
  await screen.findByRole('heading', { name: /Laid-Back Camp.*Episode 1/, level: 1 });
  expect(screen.queryByRole('button', { name: 'Watch trailer' })).toBeNull();
});

it('retains earlier pages when loading more fails and retries without losing them', async () => {
  const service = api();
  service.list.mockResolvedValueOnce({ items: [title], source: 'live', pageInfo: { page: 1, hasNextPage: true } })
    .mockRejectedValueOnce(Error('temporary provider failure'))
    .mockResolvedValueOnce({ items: [{ ...title, id: '12189', title: 'Hyouka' }], source: 'live', pageInfo: { page: 2, hasNextPage: false } });
  render(<AnimePage api={service} favorites={favorites()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load more anime' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Details for Laid-Back Camp' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('button', { name: 'Details for Hyouka' });
  expect(screen.getByRole('button', { name: 'Details for Laid-Back Camp' })).toBeTruthy();
});

it('closes an open trailer when history changes to an episode of the same title', async () => {
  const service = api(); service.details.mockResolvedValue({ ...title, trailerId: 'vpH42sJ8t9c' });
  const view = render(<AnimePage api={service} animeId="98444" favorites={favorites()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Watch trailer' }));
  expect(screen.getByRole('dialog', { name: 'Laid-Back Camp trailer' })).toBeTruthy();
  view.rerender(<AnimePage api={service} animeId="98444" episode={1} favorites={favorites()} />);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('selects a provider episode for watching together without leaking a stream URL', async () => {
  const service = api(), together = vi.fn(); service.details.mockResolvedValue({ ...title, id: 'ap_naruto', title: 'Naruto' });
  render(<AnimePage api={service} animeId="ap_naruto" favorites={favorites()} onWatchTogether={together} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Watch together', exact: true }));
  expect(together).toHaveBeenCalledWith({ source: 'anime', id: 'ap_naruto', episode: 1, title: 'Naruto', position: 0 });
});

const gundamId = 'ap_kidou-senshi-gundam-suisei-no-majo';
const gundamTitle = 'Mobile Suit Gundam: The Witch from Mercury';
function dubService() {
  const service = api();
  service.details.mockResolvedValue({ ...title, id: gundamId, title: gundamTitle, episodes: [1, 2, 13].map(number => ({ number, source: 'hls', provider: 'AnimeParadise', language: 'Subtitled', embeddable: true })) });
  service.stream = vi.fn(() => new Promise(() => {}));
  return service;
}
function youtubePlayer() {
  const destroy = vi.fn();
  window.YT = { Player: vi.fn(function () { return { destroy }; }) };
  return { construct: window.YT.Player, destroy };
}

it('switches a verified standalone episode between native Sub and official YouTube Dub players', async () => {
  const service = dubService(), player = youtubePlayer();
  render(<AnimePage api={service} animeId={gundamId} episode={1} youtubeReady favorites={favorites()} />);
  await screen.findByRole('heading', { name: `${gundamTitle} — Episode 1`, level: 1 });
  await waitFor(() => expect(service.stream).toHaveBeenCalledOnce());
  const subSignal = service.stream.mock.calls[0][2].signal;
  fireEvent.click(screen.getByRole('button', { name: 'Dub', exact: true }));
  await waitFor(() => expect(player.construct).toHaveBeenCalledOnce());
  expect(player.construct.mock.calls[0][1].videoId).toBe('cq8zYG_hivI');
  expect(subSignal.aborted).toBe(true);
  expect(document.querySelector('video')).toBeNull();
  expect(screen.getByRole('button', { name: 'Dub', exact: true }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Sub', exact: true }));
  expect(player.destroy).toHaveBeenCalledOnce();
  expect(document.querySelector('video')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Sub', exact: true }).getAttribute('aria-pressed')).toBe('true');
});

it('shares only the verified YouTube Dub source at time zero', async () => {
  const service = dubService(), together = vi.fn();
  render(<AnimePage api={service} animeId={gundamId} episode={1} favorites={favorites()} onWatchTogether={together} />);
  await screen.findByRole('heading', { name: `${gundamTitle} — Episode 1`, level: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Dub', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Watch together', exact: true }));
  expect(together).toHaveBeenCalledWith({ source: 'youtube', id: 'cq8zYG_hivI', title: `${gundamTitle} · Episode 1 · English dub`, position: 0 });
});

it('retains Dub for the second verified episode and falls back honestly for an unmapped episode', async () => {
  const service = dubService(), player = youtubePlayer();
  const view = render(<AnimePage api={service} animeId={gundamId} episode={1} youtubeReady favorites={favorites()} />);
  await screen.findByRole('heading', { name: `${gundamTitle} — Episode 1`, level: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Dub', exact: true }));
  view.rerender(<AnimePage api={service} animeId={gundamId} episode={2} youtubeReady favorites={favorites()} />);
  await waitFor(() => expect(player.construct.mock.calls.at(-1)[1].videoId).toBe('bRqqvwxlPFA'));
  view.rerender(<AnimePage api={service} animeId={gundamId} episode={13} youtubeReady favorites={favorites()} />);
  expect(screen.getByRole('button', { name: 'Dub', exact: true }).disabled).toBe(true);
  expect(screen.getByText('No verified English dub is listed for this episode.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Sub', exact: true }).getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector('video')).toBeTruthy();
});

it('offers only mapped Dub episodes in the room browser without starting a solo player', async () => {
  const service = dubService(), together = vi.fn();
  render(<AnimePage api={service} animeId={gundamId} roomBrowser favorites={favorites()} onWatchTogether={together} />);
  await screen.findByRole('heading', { name: gundamTitle, level: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Dub', exact: true }));
  expect(screen.queryByRole('button', { name: 'Watch episode 13', exact: true })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Watch episode 2', exact: true }));
  expect(together).toHaveBeenCalledWith({ source: 'youtube', id: 'bRqqvwxlPFA', title: `${gundamTitle} · Episode 2 · English dub`, position: 0 });
  expect(service.stream).not.toHaveBeenCalled();
  expect(document.querySelector('video, iframe')).toBeNull();
});

it('does not carry a mapped title audio selection to another anime', async () => {
  const service = dubService();
  const view = render(<AnimePage api={service} animeId={gundamId} favorites={favorites()} />);
  await screen.findByRole('heading', { name: gundamTitle, level: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Dub', exact: true }));
  service.details.mockResolvedValue({ ...title, id: 'ap_naruto', title: 'Naruto' });
  view.rerender(<AnimePage api={service} animeId="ap_naruto" favorites={favorites()} />);
  await screen.findByRole('heading', { name: 'Naruto', level: 1 });
  expect(screen.getByRole('button', { name: 'Dub', exact: true }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Sub', exact: true }).getAttribute('aria-pressed')).toBe('true');
});
