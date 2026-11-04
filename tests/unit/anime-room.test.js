import { expect, it } from 'vitest';
import { parseAnimeRoomSelection, animeRoomFields, animeRoomScope } from '../../src/anime/room';
it('accepts only canonical anime choices or this app’s episode links', () => {
  const choice = { source: 'anime', id: 'ap_naruto', episode: 2, title: 'Naruto' };
  expect(parseAnimeRoomSelection(choice)).toMatchObject(choice);
  expect(parseAnimeRoomSelection('https://party.example/anime/ap_naruto/watch/2', 'https://party.example')).toMatchObject({ source: 'anime', id: choice.id, episode: 2 });
  for (const value of [{ ...choice, episode: 0 }, { ...choice, id: '../bad' }, { ...choice, episode: 1.5 },
    'https://outside.example/anime/ap_naruto/watch/1', 'https://party.example/anime/ap_naruto/watch/1?token=private']) expect(parseAnimeRoomSelection(value, 'https://party.example')).toBeNull();
});
it('publishes stable selection fields and gives each episode and reload its own scope', () => {
  const room = { id: 'ROOM', videoSource: 'anime', videoId: 'ap_naruto', animeEpisode: 1, mediaSelectionId: 'first' };
  expect(animeRoomFields({ id: room.videoId, episode: 1, title: 'Naruto', source: 'anime', sourceUrl: 'never-store' }))
    .toEqual({ videoSource: 'anime', videoId: 'ap_naruto', animeEpisode: 1, animeTitle: 'Naruto' });
  expect(animeRoomScope(room)).not.toBe(animeRoomScope({ ...room, animeEpisode: 2 }));
  expect(animeRoomScope(room)).not.toBe(animeRoomScope({ ...room, mediaSelectionId: 'retry' }));
  expect(animeRoomScope({ ...room, videoSource: 'youtube' })).toBeNull();
});
