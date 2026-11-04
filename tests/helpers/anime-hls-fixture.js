import { readFile } from 'node:fs/promises';
export const animeFixture = { id: 'ap_naruto', provider: 'animeparadise', title: 'Naruto', description: 'Local anime integration fixture.', genres: ['Action'],
  links: [], cover: '', banner: '', source: 'live', episodes: [1, 2].map(number => ({ id: `9eb4f092-eac5-4ce6-8a45-0c874f99415${number}`, number, source: 'hls', embeddable: true, provider: 'AnimeParadise', language: 'Subtitled' })) };
export async function fulfillAnimeFixture(route) {
  const url = new URL(route.request().url()), headers = { 'access-control-allow-origin': '*' };
  if (url.pathname.includes('/api/paradise')) {
    const result = url.pathname.endsWith('/stream') ? { sourceUrl: 'https://stream.animeparadise.moe/m3u8?url=room-fixture',
      subtitles: [{ src: 'https://stream.animeparadise.moe/captions?fixture=1', label: 'English', language: 'en' }] }
      : url.pathname.endsWith('/ap_naruto') ? animeFixture : { items: [animeFixture], pageInfo: { page: 1, hasNextPage: false } };
    await route.fulfill({ json: result, headers }); return true;
  }
  if (url.hostname === 'stream.animeparadise.moe') {
    if (url.pathname === '/captions') await route.fulfill({ contentType: 'text/vtt', headers, body: 'WEBVTT\n\n00:00:00.000 --> 00:00:19.900\nLocal caption fixture\n' });
    else {
      const file = url.pathname === '/m3u8' ? 'index.m3u8' : url.pathname.slice(1);
      if (!/^(?:index\.m3u8|segment-[0-9]{3}\.ts)$/.test(file)) throw Error('Unexpected fixture media request.');
      await route.fulfill({ headers, contentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t', body: await readFile(new URL(`../fixtures/anime-hls/${file}`, import.meta.url)) });
    }
    return true;
  }
  return false;
}
