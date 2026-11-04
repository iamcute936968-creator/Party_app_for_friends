import { expect, it } from 'vitest';
import * as audio from '../../src/anime/audioSources';
const mercury = 'ap_kidou-senshi-gundam-suisei-no-majo', second = `${mercury}-part-2`;
it.each([
  [mercury, 3, 'hUFpnzhpApo'], [mercury, 12, 'a6SnMdPzh0s'],
  [second, 1, 'b9UVaK2hfkk'], [second, 11, '7rIQQmrpZe4'],
  ['ap_sonic-x', 1, '9CGih4gMRlk'], ['ap_sonic-x', 26, 'Lj6TQAJaj4s'],
])('maps independently verified %s episode %i in both directions', (animeId, episode, id) => {
  expect(audio.getDubSelection(animeId, episode)).toMatchObject({ source: 'youtube', id, position: 0 });
  expect(audio.getDubContext(id)).toMatchObject({ animeId, episode });
});
it('keeps local season numbering separate from the uploader global episode numbering', () => {
  expect(audio.getDubEpisodes(mercury)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  expect(audio.getDubEpisodes(second)).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
  expect(audio.getDubEpisodes('ap_sonic-x')).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
  expect(audio.getDubSelection(second, 13)).toBeNull();
  expect(audio.getDubSelection(second, 12)).toBeNull(); // Last upload's audio was not independently confirmed.
  expect(audio.getDubSelection('ap_sonic-x', 27)).toBeNull();
});
it('attributes each uploader correctly without inventing sources for unknown titles', () => {
  expect(audio.getDubProvider?.(mercury)).toBe('GUNDAM CHANNEL INTL');
  expect(audio.getDubProvider?.('ap_sonic-x')).toBe('Anime! on TMS Official Channel');
  for (const value of ['ap_naruto', '__proto__', 'constructor', null]) {
    expect(audio.getDubEpisodes(value)).toEqual([]); expect(audio.getDubSelection(value, 1)).toBeNull();
    expect(audio.getDubProvider?.(value)).toBe('');
  }
});
