import { expect, it, vi } from 'vitest';
import { createParadiseApi, normalizeParadiseAnime } from '../../src/anime/paradise';

const id = 'ap_naruto';
const anime = { id, title: 'Naruto', genres: ['Action'], episodes: [], provider: 'animeparadise', cover: 'https://media.kitsu.app/anime/poster_images/11/large.jpg', links: [] };
const reply = value => ({ ok: true, status: 200, json: async () => value });
it('normalizes provider titles and images without accepting arbitrary image or episode URLs', () => {
  const item = normalizeParadiseAnime({ ...anime, description: '<b>A ninja.</b>', cover: 'https://media.kitsu.app/anime/poster_images/11/large.jpg',
    episodes: [{ id: '9eb4f092-eac5-4ce6-8a45-0c874f99415e', number: 1, title: 'Enter Naruto' }], token: 'discard' });
  expect(item.id).toBe(id); expect(item.cover).toContain('media.kitsu.app'); expect(item.description).toBe('A ninja.');
  expect(item.episodes[0]).toMatchObject({ number: 1, source: 'hls', provider: 'AnimeParadise', embeddable: true });
  expect(item.token).toBeUndefined();
  expect(normalizeParadiseAnime({ ...anime, cover: 'https://media.kitsu.app.evil.test/image.jpg' }).cover).toBe('');
});
it('requests only fixed catalog/detail/stream routes and rejects malformed IDs before fetching', async () => {
  const fetchFn = vi.fn(async url => reply(url.endsWith('/stream')
    ? { sourceUrl: 'https://stream.animeparadise.moe/m3u8?url=opaque', subtitles: [] }
    : url.includes('/api/paradise?') ? { items: [anime], pageInfo: { page: 1, hasNextPage: false } } : anime));
  const api = createParadiseApi({ proxyUrl: 'http://127.0.0.1:3000', fetchFn });
  expect((await api.list({ search: 'Naruto' })).items[0].id).toBe(id);
  expect((await api.details(id)).title).toBe('Naruto');
  expect((await api.stream(id, 1)).sourceUrl).toContain('stream.animeparadise.moe');
  const count = fetchFn.mock.calls.length;
  await expect(api.details('../bad')).rejects.toThrow();
  await expect(api.stream(id, 0)).rejects.toThrow();
  expect(fetchFn).toHaveBeenCalledTimes(count);
  expect(fetchFn.mock.calls.every(([, options]) => options.credentials === 'omit' && options.redirect === 'error')).toBe(true);
});
it('rejects untrusted playback and subtitle origins, including credentialed provider URLs', async () => {
  for (const sourceUrl of ['http://stream.animeparadise.moe/m3u8?url=x', 'https://stream.animeparadise.moe.evil.test/m3u8?url=x', 'https://user:pass@stream.animeparadise.moe/m3u8?url=x']) {
    const api = createParadiseApi({ proxyUrl: 'https://proxy.example', fetchFn: async () => reply({ sourceUrl, subtitles: [] }) });
    await expect(api.stream(id, 1)).rejects.toThrow();
  }
});

it('allows the bounded multi-step provider lookup to finish beyond the legacy metadata deadline', async () => {
  vi.useFakeTimers();
  try {
    const api = createParadiseApi({ proxyUrl: 'https://proxy.example', fetchFn: () => new Promise(resolve => setTimeout(() => resolve(reply(anime)), 11000)) });
    const result = api.details(id).then(value => ({ ok: true, value }), () => ({ ok: false }));
    await vi.advanceTimersByTimeAsync(11000);
    expect((await result).ok).toBe(true);
  } finally { vi.useRealTimers(); }
});
