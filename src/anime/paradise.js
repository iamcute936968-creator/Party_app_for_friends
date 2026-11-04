import { createAnimeRequest, normalizeAnime } from './api';
export const isParadiseId = value => typeof value === 'string' && /^ap_[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value);
const failure = () => new Error('Anime title or playback is unavailable. Please try again.');
const hasControl = value => Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
function safeUrl(value, type) {
  if (typeof value !== 'string' || value.length > (type === 'image' ? 2048 : 48000) || /\s/.test(value) || hasControl(value)) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return '';
    if (type === 'image') return !url.search && ((url.hostname === 's4.anilist.co' && url.pathname.startsWith('/file/anilistcdn/media/anime/')) ||
      (url.hostname === 'media.kitsu.app' && url.pathname.startsWith('/anime/'))) ? url.href : '';
    return url.hostname === 'stream.animeparadise.moe' && url.pathname === (type === 'hls' ? '/m3u8' : '/captions') &&
      (type !== 'hls' || (url.searchParams.getAll('url').length === 1 && Boolean(url.searchParams.get('url')))) ? url.href : '';
  } catch { return ''; }
}
export function normalizeParadiseAnime(value) {
  if (!isParadiseId(value?.id)) return null;
  const item = normalizeAnime({ ...value, id: '1', cover: '', banner: '', episodes: [] });
  if (!item || !Array.isArray(value.episodes)) return null;
  const seen = new Set();
  return { ...item, id: value.id, provider: 'animeparadise', cover: safeUrl(value.cover, 'image'), banner: safeUrl(value.banner, 'image'),
    episodes: value.episodes.slice(0, 3000).flatMap(ep => {
      if (!ep || !Number.isInteger(ep.number) || ep.number < 1 || ep.number > 9999 || seen.has(ep.number) ||
        typeof ep.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(ep.id)) return [];
      seen.add(ep.number);
      return [{ id: ep.id, number: ep.number, title: typeof ep.title === 'string' ? ep.title.slice(0, 300) : '', source: 'hls', provider: 'AnimeParadise', language: 'Subtitled', embeddable: true }];
    }).sort((a, b) => a.number - b.number) };
}
export function createParadiseApi(options = {}) {
  // The backend bounds complete provider lookups to 25 seconds, including bodies.
  const request = createAnimeRequest({ cacheMetadata: true, timeoutMs: 28000, ...options });
  return {
    list: async ({ search = '', page = 1, genre = '' } = {}, { signal } = {}) => {
      if (typeof search !== 'string' || search.length > 80 || hasControl(search) || !Number.isInteger(page) || page < 1 || page > 50 ||
        typeof genre !== 'string' || (genre && !['Action','Adventure','Comedy','Drama','Fantasy','Mystery','Romance','Sci-Fi','Slice of Life','Sports'].includes(genre))) throw failure();
      const data = await request(`/api/paradise?${new URLSearchParams({ search: search.trim(), page: String(page), genre })}`, signal);
      if (!Array.isArray(data?.items) || data.pageInfo?.page !== page || typeof data.pageInfo?.hasNextPage !== 'boolean') throw failure();
      return { items: [...new Map(data.items.slice(0, 16).map(normalizeParadiseAnime).filter(Boolean).map(item => [item.id, item])).values()], pageInfo: data.pageInfo, source: 'live' };
    },
    details: async (id, { signal } = {}) => {
      if (!isParadiseId(id)) throw failure();
      const item = normalizeParadiseAnime(await request(`/api/paradise/${id}`, signal));
      if (!item || item.id !== id) throw failure(); return item;
    },
    stream: async (id, episode, { signal } = {}) => {
      if (!isParadiseId(id) || !Number.isInteger(episode) || episode < 1 || episode > 9999) throw failure();
      const data = await request(`/api/paradise/${id}/episodes/${episode}/stream`, signal), sourceUrl = safeUrl(data?.sourceUrl, 'hls');
      if (!sourceUrl || !Array.isArray(data.subtitles)) throw failure();
      return { sourceUrl, subtitles: data.subtitles.slice(0, 30).flatMap(track => {
        const src = safeUrl(track?.src, 'caption');
        if (!src || typeof track.label !== 'string' || !track.label.trim()) return [];
        return [{ src, label: track.label.slice(0, 80), language: /^[a-z]{2,3}(?:-[A-Za-z0-9]+)?$/.test(track.language || '') ? track.language : 'und' }];
      }) };
    },
  };
}
