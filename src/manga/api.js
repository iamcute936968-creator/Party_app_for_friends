import { createAnimeRequest, proxyBase } from '../anime/api';
export const validMangaId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const text = (value, max = 12000) => typeof value === 'string' ? value.slice(0, max).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, ' ').trim() : '';
const failure = code => Object.assign(new Error('Manga or chapter is unavailable. Please try again.'), { code: code || 'MANGA_UNAVAILABLE' });
function manga(raw) {
  if (!validMangaId(raw?.id) || !text(raw.title, 300)) return null;
  return { id: raw.id, title: text(raw.title, 300), description: text(raw.description), year: Number.isInteger(raw.year) ? raw.year : null,
    status: text(raw.status, 40), authors: (Array.isArray(raw.authors) ? raw.authors : []).slice(0, 20).map(value => text(value, 120)).filter(Boolean),
    genres: (Array.isArray(raw.genres) ? raw.genres : []).slice(0, 30).map(value => text(value, 60)).filter(Boolean) };
}
function chapter(raw, id) {
  if (!validMangaId(raw?.id) || raw.mangaId !== id || !Number.isInteger(raw.pageCount) || raw.pageCount < 0 || raw.pageCount > 500 || typeof raw.external !== 'boolean') return null;
  return { id: raw.id, mangaId: id, title: text(raw.title, 300), number: text(raw.number, 30), volume: text(raw.volume, 30), pageCount: raw.pageCount, external: raw.external,
    groups: (Array.isArray(raw.groups) ? raw.groups : []).slice(0, 30).filter(group => validMangaId(group?.id) && text(group.name, 120)).map(group => ({ id: group.id, name: text(group.name, 120) })) };
}
export function createMangaApi(options = {}) {
  const base = proxyBase(options.proxyUrl), mediaRequest = createAnimeRequest({ cacheMetadata: true, timeoutMs: 28000, ...options });
  const request = async (path, signal) => {
    try { return await mediaRequest('/api/manga' + path, signal); }
    catch (error) { if (error?.name === 'AbortError') throw error; throw failure(error?.code === 'ANIME_NOT_FOUND' ? 'MANGA_NOT_FOUND' : undefined); }
  };
  const check = id => { if (!validMangaId(id)) throw failure(); };
  const listResult = (data, page, normalize) => {
    if (!Array.isArray(data?.items) || data.pageInfo?.page !== page || typeof data.pageInfo?.hasNextPage !== 'boolean') throw failure();
    return { items: [...new Map(data.items.slice(0, 20).map(normalize).filter(Boolean).map(item => [item.id, item])).values()], pageInfo: { page, hasNextPage: data.pageInfo.hasNextPage } };
  };
  return {
    list: async ({ search = '', page = 1 } = {}, { signal } = {}) => {
      if (typeof search !== 'string' || search.length > 80 || Array.from(search).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || !Number.isInteger(page) || page < 1 || page > 50) throw failure();
      return listResult(await request(`?${new URLSearchParams({ search: search.trim(), page: String(page) })}`, signal), page, manga);
    },
    details: async (id, { signal } = {}) => { check(id); const item = manga(await request(`/${id}`, signal)); if (!item || item.id !== id) throw failure(); return item; },
    chapters: async (id, page = 1, { signal } = {}) => {
      check(id); if (!Number.isInteger(page) || page < 1 || page > 500) throw failure();
      return listResult(await request(`/${id}/chapters?page=${page}`, signal), page, value => chapter(value, id));
    },
    chapter: async (id, chapterId, { signal } = {}) => {
      check(id); check(chapterId); const item = chapter(await request(`/${id}/chapters/${chapterId}`, signal), id);
      if (!item || item.id !== chapterId) throw failure(); return item;
    },
    navigation: async (id, { signal } = {}) => {
      check(id); const data = await request(`/${id}/navigation`, signal);
      if (!Array.isArray(data?.items) || data.items.length > 10000) throw failure();
      let count = data.items.length;
      const items = data.items.map(item => {
        if (!validMangaId(item?.id) || typeof item.number !== 'string' || item.number.length > 30 || typeof item.volume !== 'string' || item.volume.length > 30 || !Array.isArray(item.aliases) || item.aliases.some(value => !validMangaId(value))) throw failure();
        count += item.aliases.length; if (count > 10000) throw failure();
        return { id: item.id, number: item.number, volume: item.volume, aliases: [...new Set(item.aliases)] };
      });
      return { items: [...new Map(items.map(item => [item.id, item])).values()] };
    },
    coverUrl: id => { check(id); return base ? `${base}/api/manga/${id}/cover` : ''; },
    pageUrl: (id, chapterId, page, attempt = 0) => {
      check(id); check(chapterId); if (!Number.isInteger(page) || page < 0 || page > 499 || !Number.isInteger(attempt) || attempt < 0 || attempt > 99) throw failure();
      return base ? `${base}/api/manga/${id}/chapters/${chapterId}/pages/${page}?attempt=${attempt}` : '';
    },
  };
}
