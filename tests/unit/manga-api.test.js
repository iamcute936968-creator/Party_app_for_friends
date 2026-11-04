import { expect, it, vi } from 'vitest';
import { createMangaApi } from '../../src/manga/api';
const id = '58be6aa6-06cb-4ca5-bd20-f1392ce451fb', chapter = 'ff4f79de-6102-4610-8327-539904cfe549';
it('loads bounded chapter navigation and rejects untrusted selectors', async () => {
  const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [{ id: chapter, number: '1.5', volume: '1', aliases: [id] }] }) }));
  const api = createMangaApi({ proxyUrl: 'https://proxy.example', fetchFn });
  expect(await api.navigation(id)).toEqual({ items: [{ id: chapter, number: '1.5', volume: '1', aliases: [id] }] });
  expect(fetchFn.mock.calls[0][0]).toContain(`/api/manga/${id}/navigation`);
  fetchFn.mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [{ id: 'bad', number: '1', aliases: [] }] }) });
  await expect(api.navigation(id)).rejects.toThrow();
});
it('uses fixed manga routes and constructs proxy images instead of trusting upstream URLs', async () => {
  const fetchFn = vi.fn(async url => ({ ok: true, status: 200, json: async () => url.includes('/chapters/') ? { id: chapter, mangaId: id, number: '1.5', title: 'Chapter', pageCount: 2, external: false, groups: [] }
    : url.includes('?') ? { items: [{ id, title: 'Yotsuba', genres: [] }], pageInfo: { page: 1, hasNextPage: false } } : { id, title: 'Yotsuba', genres: [], coverUrl: 'https://outside.example/unsafe' } }));
  const api = createMangaApi({ proxyUrl: 'https://proxy.example', fetchFn });
  expect((await api.list({ search: 'Yotsuba' })).items[0].title).toBe('Yotsuba');
  expect((await api.details(id)).coverUrl).toBeUndefined(); expect((await api.chapter(id, chapter)).number).toBe('1.5');
  expect(api.coverUrl(id)).toBe(`https://proxy.example/api/manga/${id}/cover`);
  expect(api.pageUrl(id, chapter, 0)).toBe(`https://proxy.example/api/manga/${id}/chapters/${chapter}/pages/0?attempt=0`);
  const calls = fetchFn.mock.calls.length; await expect(api.details('../bad')).rejects.toThrow(); expect(fetchFn).toHaveBeenCalledTimes(calls);
});
