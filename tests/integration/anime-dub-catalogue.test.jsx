import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AnimePage from '../../src/components/AnimePage';
import RoomAnimeControls from '../../src/components/RoomAnimeControls';
const base = { id: 'ap_sonic-x', title: 'Sonic X', description: '', genres: [], links: [], cover: '', banner: '', totalEpisodes: 52,
  episodes: Array.from({ length: 52 }, (_, i) => ({ number: i + 1, source: 'hls', provider: 'AnimeParadise', language: 'Subtitled', embeddable: true })) };
const api = item => ({ details: vi.fn(async () => item), stream: vi.fn(), list: vi.fn() });
afterEach(cleanup);
it('browses only verified Sonic Dub episodes and shares the selected upload without mounting a solo player', async () => {
  const service = api(base), together = vi.fn();
  render(<AnimePage roomBrowser api={service} animeId={base.id} onWatchTogether={together} />);
  await screen.findByRole('heading', { name: 'Sonic X', level: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Dub', exact: true }));
  expect(screen.getByText(/26 verified official YouTube episodes/)).toBeTruthy();
  expect(screen.getAllByText(/Anime! on TMS Official Channel/).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Watch episode 27', exact: true })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Watch episode 26', exact: true }));
  expect(together).toHaveBeenCalledWith(expect.objectContaining({ source: 'youtube', id: 'Lj6TQAJaj4s', position: 0 }));
  expect(service.stream).not.toHaveBeenCalled(); expect(document.querySelector('video, iframe')).toBeNull();
});
it('keeps unverified season-two episodes unavailable in Dub and restores them in Sub', async () => {
  const id = 'ap_kidou-senshi-gundam-suisei-no-majo-part-2', title = 'Mobile Suit Gundam: The Witch from Mercury Season 2';
  render(<AnimePage roomBrowser api={api({ ...base, id, title, episodes: base.episodes.slice(0, 12) })} animeId={id} />);
  await screen.findByRole('heading', { name: title, level: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Dub', exact: true }));
  expect(screen.getByText(/11 verified official YouTube episodes/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Watch episode 12', exact: true })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Sub', exact: true }));
  expect(screen.getByRole('button', { name: 'Watch episode 12', exact: true })).toBeTruthy();
});
it('credits the correct room uploader and switches back to the correct Sonic Sub episode for the host only', () => {
  const load = vi.fn(), props = { source: 'youtube', videoId: 'Lj6TQAJaj4s', room: {}, load };
  const view = render(<RoomAnimeControls {...props} isHost={false} />);
  expect(screen.getByRole('button', { name: 'Sub', exact: true }).disabled).toBe(true);
  expect(screen.getByText(/Anime! on TMS Official Channel/)).toBeTruthy();
  view.rerender(<RoomAnimeControls {...props} isHost />);
  fireEvent.click(screen.getByRole('button', { name: 'Sub', exact: true }));
  expect(load).toHaveBeenCalledWith({ source: 'anime', id: 'ap_sonic-x', episode: 26, title: 'Sonic X', position: 0 });
});
