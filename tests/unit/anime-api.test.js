import { afterEach, expect, it, vi } from 'vitest';
import { createAnimeApi, createAnimeRequest, normalizeAnime } from '../../src/anime/api';
afterEach(() => vi.restoreAllMocks());
const item = (extra = {}) => ({ id: '98444', title: 'Laid-Back Camp', genres: ['Comedy'], cover: '', banner: '', score: 80,
  episodes: [{ number: 1, id: '2C7Kp0yBpvo', provider: 'Ani-One Asia', language: 'Japanese', embeddable: true }], links: [], ...extra });
const response = data => ({ ok: true, status: 200, json: async () => data });
it('uses only a safe configured proxy and serializes fixed list/detail operations', async () => {
  const calls = []; const api = createAnimeApi({ proxyUrl: 'https://proxy.example/', fetchFn: async (url, options) => {
    calls.push({ url, options }); return response(url.includes('/api/anime/') ? item() : { items: [item()], pageInfo: { page: 1, hasNextPage: false }, source: 'live' });
  } });
  expect((await api.list({ collection: 'official', search: 'camp & friends', page: 1 })).items).toHaveLength(1);
  expect(new URL(calls[0].url).searchParams.get('search')).toBe('camp & friends');
  expect(calls[0].options.credentials).toBe('omit');
  expect((await api.details('98444')).id).toBe('98444');
  await expect(api.details('../bad')).rejects.toThrow();
  for (const proxyUrl of ['javascript:alert(1)', 'https://user:pass@outside.example', 'https://proxy.example/?secret=value']) {
    const fetchFn = vi.fn(); await expect(createAnimeApi({ proxyUrl, fetchFn }).list()).rejects.toThrow(); expect(fetchFn).not.toHaveBeenCalled();
  }
});
it('rejects unsafe metadata destinations and excluded titles at the browser boundary', () => {
  expect(normalizeAnime(item({ genres: ['Ecchi'] }))).toBeNull();
  const clean = normalizeAnime(item({ cover: 'https://outside.example/pixel', trailerId: '../bad',
    links: [{ site: 'Bad', url: 'javascript:alert(1)' }], episodes: [{ number: 1, id: '../bad', embeddable: true }] }));
  expect(clean.cover).toBe(''); expect(clean.trailerId).toBe(''); expect(clean.links).toEqual([]); expect(clean.episodes).toEqual([]);
});
it('does not fabricate ratings and maps missing titles and provider errors safely', async () => {
  expect(normalizeAnime(item({ score: null })).score).toBeNull();
  const json = vi.fn();
  const api = createAnimeApi({ proxyUrl: 'https://proxy.example', fetchFn: async () => ({ ok: false, status: 404, json }) });
  await expect(api.details('98444')).rejects.toMatchObject({ code: 'ANIME_NOT_FOUND' }); expect(json).not.toHaveBeenCalled();
});
it('cancels in-flight requests even if the fetcher ignores AbortSignal', async () => {
  const abort = new AbortController(); const fetchFn = vi.fn(() => new Promise(() => {}));
  const api = createAnimeApi({ proxyUrl: 'https://proxy.example', fetchFn });
  const pending = api.list({}, { signal: abort.signal }); abort.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});

const catalogue = (page = 1, extra = {}) => ({ items: [item()], pageInfo: { page, hasNextPage: false }, source: 'live', ...extra });
it('only caches public catalogue metadata when explicitly enabled and clones every return', async () => {
  const fetchFn = vi.fn(async () => response(catalogue()));
  const fresh = createAnimeRequest({ proxyUrl: 'https://proxy.example', fetchFn });
  await fresh('/api/anime?page=1'); await fresh('/api/anime?page=1'); expect(fetchFn).toHaveBeenCalledTimes(2);
  const cached = createAnimeRequest({ proxyUrl: 'https://proxy.example', fetchFn, cacheMetadata: true });
  const first = await cached('/api/anime?page=1'); first.items[0].title = 'Mutated';
  const second = await createAnimeRequest({ proxyUrl: 'https://proxy.example', fetchFn, cacheMetadata: true })('/api/anime?page=1');
  expect(second.items[0].title).toBe('Laid-Back Camp'); second.pageInfo.hasNextPage = true;
  expect((await cached('/api/anime?page=1')).pageInfo.hasNextPage).toBe(false);
  expect(fetchFn).toHaveBeenCalledTimes(3);
});
it('admits matching valid list envelopes for each public catalogue only', async () => {
  for (const [kind, id] of [['anime', '98444'], ['paradise', 'ap_naruto'], ['movies', '10378'], ['manga', '58be6aa6-06cb-4ca5-bd20-f1392ce451fb']]) {
    const fetchFn = vi.fn(async () => response(catalogue(1, { items: [item({ id })] })));
    const request = createAnimeRequest({ proxyUrl: 'https://proxy.example', fetchFn, cacheMetadata: true });
    await request(`/api/${kind}?page=1`); await request(`/api/${kind}?page=1`);
    expect(fetchFn).toHaveBeenCalledOnce();
  }
});
it('isolates query, proxy and fetch-function identities and expires cached lists after thirty seconds', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000), fetchFn = vi.fn(async () => response(catalogue()));
  const cached = createAnimeRequest({ proxyUrl: 'https://proxy.example', fetchFn, cacheMetadata: true });
  await cached('/api/anime?page=1&search=one'); await cached('/api/anime?page=1&search=two');
  await createAnimeRequest({ proxyUrl: 'https://other.example', fetchFn, cacheMetadata: true })('/api/anime?page=1&search=one');
  expect(fetchFn).toHaveBeenCalledTimes(3);
  const otherFetch = vi.fn(async () => response(catalogue()));
  await createAnimeRequest({ proxyUrl: 'https://proxy.example', fetchFn: otherFetch, cacheMetadata: true })('/api/anime?page=1&search=one'); expect(otherFetch).toHaveBeenCalledOnce();
  clock.mockReturnValue(30999); await cached('/api/anime?page=1&search=one'); expect(fetchFn).toHaveBeenCalledTimes(3);
  clock.mockReturnValue(31000); await cached('/api/anime?page=1&search=one'); expect(fetchFn).toHaveBeenCalledTimes(4);
});
it('limits retained catalogue responses to twenty entries and excludes responses over256KiB', async () => {
  const fetchFn = vi.fn(async () => response(catalogue()));
  const cached = createAnimeRequest({ proxyUrl: 'https://proxy.example', fetchFn, cacheMetadata: true });
  for (let i = 0; i < 21; i++) await cached(`/api/anime?page=1&search=${i}`);
  await cached('/api/anime?page=1&search=0'); expect(fetchFn).toHaveBeenCalledTimes(22);
  const largeFetch = vi.fn(async () => response(catalogue(1, { notice: '界'.repeat(90000) })));
  const large = createAnimeRequest({ proxyUrl: 'https://proxy.example', fetchFn: largeFetch, cacheMetadata: true });
  await large('/api/anime?page=1'); await large('/api/anime?page=1'); expect(largeFetch).toHaveBeenCalledTimes(2);
});
it('does not cache details, streams, chapters, auth, images, duplicate or credential-bearing queries', async () => {
  const fetchFn = vi.fn(async () => response(catalogue())), request = createAnimeRequest({ proxyUrl: 'https://proxy.example', fetchFn, cacheMetadata: true });
  const paths = ['/api/anime/98444', '/api/paradise/ap_naruto/episodes/1/stream', '/api/manga/title/chapters?page=1', '/api/manga/title/cover', '/api/auth?page=1', '/api/anime?page=1&token=private', '/api/anime?page=1&page=1', '/api/anime?page=51'];
  for (const path of paths) { await request(path); await request(path); }
  expect(fetchFn).toHaveBeenCalledTimes(paths.length * 2);
});
it('does not cache HTTP errors or malformed catalogue success envelopes', async () => {
  const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue(response(catalogue()));
  const request = createAnimeRequest({ proxyUrl: 'https://proxy.example', fetchFn, cacheMetadata: true });
  await expect(request('/api/anime?page=1')).rejects.toThrow(); await request('/api/anime?page=1'); expect(fetchFn).toHaveBeenCalledTimes(2);
  for (const bad of [{ error: 'unavailable' }, catalogue(2), catalogue(1, { source: 'invalid' }), catalogue(1, { items: Array(21).fill(item()) }), catalogue(1, { error: 'provider error' }), catalogue(1, { items: [{ id: 'bad', title: 'Title' }] })]) {
    const fn = vi.fn(async () => response(bad)), uncached = createAnimeRequest({ proxyUrl: 'https://proxy.example', fetchFn: fn, cacheMetadata: true });
    await uncached('/api/anime?page=1'); await uncached('/api/anime?page=1'); expect(fn).toHaveBeenCalledTimes(2);
  }
});
it('checks cancellation before a cache hit and never caches a body that arrives after abort', async () => {
  const fetchFn = vi.fn(async () => response(catalogue())), cached = createAnimeRequest({ proxyUrl: 'https://proxy.example', fetchFn, cacheMetadata: true });
  await cached('/api/anime?page=1'); const aborted = new AbortController(); aborted.abort();
  await expect(cached('/api/anime?page=1', aborted.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(fetchFn).toHaveBeenCalledOnce();
  let finish, started; const ready = new Promise(resolve => { started = resolve; });
  const lateFetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: () => { started(); return new Promise(resolve => { finish = resolve; }); } }).mockResolvedValue(response(catalogue()));
  const late = createAnimeRequest({ proxyUrl: 'https://proxy.example', fetchFn: lateFetch, cacheMetadata: true }), controller = new AbortController();
  const pending = late('/api/anime?page=1', controller.signal); await ready; controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); finish(catalogue()); await Promise.resolve(); await Promise.resolve();
  await late('/api/anime?page=1'); expect(lateFetch).toHaveBeenCalledTimes(2);
});
