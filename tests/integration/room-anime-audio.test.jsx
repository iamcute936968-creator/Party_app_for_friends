import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import RoomAnimeControls from '../../src/components/RoomAnimeControls';
const id = 'ap_kidou-senshi-gundam-suisei-no-majo';
afterEach(cleanup);
it('host switches to the verified shared Dub selection at the start', () => {
  const load = vi.fn();
  render(<RoomAnimeControls source="anime" videoId={id} room={{ animeEpisode: 1, animeTitle: 'Gundam' }} isHost load={load} />);
  fireEvent.click(screen.getByRole('button', { name: 'Dub' }));
  expect(load).toHaveBeenCalledWith(expect.objectContaining({ source: 'youtube', id: 'cq8zYG_hivI', position: 0 }));
});
it('reverse maps a Dub video to a shared Sub episode and denies member switching', () => {
  const load = vi.fn();
  const props = { source: 'youtube', videoId: 'bRqqvwxlPFA', room: {}, load };
  const { rerender } = render(<RoomAnimeControls {...props} isHost={false} />);
  expect(screen.getByRole('button', { name: 'Sub' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Sub' })); expect(load).not.toHaveBeenCalled();
  rerender(<RoomAnimeControls {...props} isHost />);
  fireEvent.click(screen.getByRole('button', { name: 'Sub' }));
  expect(load).toHaveBeenCalledWith(expect.objectContaining({ source: 'anime', id, episode: 2, position: 0 }));
});
it('does not invent Dub sources for unavailable titles or episodes', () => {
  render(<RoomAnimeControls source="anime" videoId={id} room={{ animeEpisode: 13 }} isHost />);
  expect(screen.getByRole('button', { name: 'Dub' }).disabled).toBe(true);
  expect(screen.getByText(/No verified Dub source/)).toBeTruthy();
});
