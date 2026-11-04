const GENRES = new Set(['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Mystery', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports']);
const SORTS = new Set(['trending', 'popular', 'score']);
const validId = id => typeof id === 'string' && /^[1-9][0-9]{0,9}$/.test(id) && Number(id) <= 2147483647;
const videoId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
const hasControl = value => Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const text = (value, max) => typeof value === 'string' ? Array.from(value.trim().slice(0, max))
  .filter(character => character.charCodeAt(0) !== 127 && (character.charCodeAt(0) >= 32 || [9, 10, 13].includes(character.charCodeAt(0)))).join('').trim() : '';
const positive = (value, max) => Number.isInteger(value) && value > 0 && value <= max ? value : null;
const failure = (code = 'ANIME_UNAVAILABLE') => Object.assign(new Error(code === 'ANIME_NOT_FOUND'
  ? 'Anime title not found.' : 'Anime information is temporarily unavailable. Please try again.'), { code });
const cancelled = () => Object.assign(new Error('Request cancelled.'), { name: 'AbortError' });

function image(value, kind) {
  if (typeof value !== 'string' || value.length > 2048 || /\s/.test(value) || hasControl(value)) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 's4.anilist.co' && !url.username && !url.password && !url.port &&
      !url.search && !url.hash && url.pathname.startsWith(`/file/anilistcdn/media/anime/${kind}/`) &&
      url.pathname.length > `/file/anilistcdn/media/anime/${kind}/`.length ? url.href : '';
  } catch { return ''; }
}

function providerLink(value) {
  if (!value || typeof value.url !== 'string' || value.url.length > 2048 || /\s/.test(value.url) || hasControl(value.url)) return null;
  try {
    const url = new URL(value.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    if (['youtube.com', 'www.youtube.com'].includes(url.hostname)) {
      const id = url.searchParams.get('v'), list = url.searchParams.get('list');
      if (url.pathname === '/watch' && videoId(id)) return { site: 'YouTube', url: `https://www.youtube.com/watch?v=${id}` };
      if (url.pathname === '/playlist' && /^[A-Za-z0-9_-]{1,100}$/.test(list || '')) return { site: 'YouTube', url: `https://www.youtube.com/playlist?list=${list}` };
      if (/^\/(?:@[A-Za-z0-9_.-]+|channel\/UC[A-Za-z0-9_-]+)\/?$/.test(url.pathname) && !url.search) return { site: 'YouTube', url: `https://www.youtube.com${url.pathname}` };
    }
    if (url.hostname === 'youtu.be' && videoId(url.pathname.slice(1)) && !url.search) return { site: 'YouTube', url: `https://www.youtube.com/watch?v=${url.pathname.slice(1)}` };
    if (['crunchyroll.com', 'www.crunchyroll.com'].includes(url.hostname) && !url.search &&
      /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:series|watch)\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_%-]+)*\/?$/.test(url.pathname)) return { site: 'Crunchyroll', url: url.href };
    if (['netflix.com', 'www.netflix.com'].includes(url.hostname) && !url.search && /^\/(?:[a-z]{2}\/)?title\/[0-9]+\/?$/.test(url.pathname)) return { site: 'Netflix', url: url.href };
  } catch { /* Untrusted metadata never supplies an arbitrary destination. */ }
  return null;
}

function episode(value) {
  const provider = text(value?.provider, 120), language = text(value?.language, 160);
  if (!value || !videoId(value.id) || !positive(value.number, 9999) || typeof value.provider !== 'string' ||
    typeof value.language !== 'string' || !provider || !language || typeof value.embeddable !== 'boolean') return null;
  return { number: value.number, id: value.id, provider, language,
    embeddable: value.embeddable, verifiedAt: /^\d{4}-\d{2}-\d{2}$/.test(value.verifiedAt || '') ? value.verifiedAt : '',
    url: `https://www.youtube.com/watch?v=${value.id}` };
}

export function normalizeAnime(value) {
  const title = text(value?.title, 300);
  if (!value || typeof value !== 'object' || Array.isArray(value) || !validId(value.id) || typeof value.title !== 'string' ||
    !title || value.isAdult === true || !Array.isArray(value.genres) || value.genres.length > 30 ||
    value.genres.some(genre => typeof genre !== 'string' || /^(?:ecchi|hentai)$/i.test(genre.trim())) ||
    !Array.isArray(value.episodes) || (value.links !== undefined && !Array.isArray(value.links))) return null;
  const episodes = value.episodes.slice(0, 200).map(episode).filter(Boolean);
  const seenEpisodes = new Set();
  const links = (value.links || []).slice(0, 30).map(providerLink).filter(Boolean);
  return { id: value.id, title, nativeTitle: text(value.nativeTitle, 300),
    description: text(value.description, 30000).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    genres: value.genres.map(genre => text(genre, 60)).filter(Boolean),
    score: Number.isFinite(value.score) && value.score > 0 && value.score <= 100 ? value.score : null,
    year: positive(value.year, 9999), totalEpisodes: positive(value.totalEpisodes, 100000), duration: positive(value.duration, 10000),
    format: text(value.format, 30), status: text(value.status, 40), studio: text(value.studio, 120),
    cover: image(value.cover, 'cover'), banner: image(value.banner, 'banner'), trailerId: videoId(value.trailerId) ? value.trailerId : '',
    links: [...new Map(links.map(link => [link.url, link])).values()],
    episodes: episodes.filter(item => { if (seenEpisodes.has(item.number)) return false; seenEpisodes.add(item.number); return true; }),
    source: ['live', 'curated'].includes(value.source) ? value.source : '', notice: text(value.notice, 500) };
}

export function proxyBase(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value.trim());
    const loopback = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((!loopback && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) return '';
    return url.href.replace(/\/+$/, '');
  } catch { return ''; }
}

const catalogueCaches = new WeakMap();
const catalogueQueryKeys = {
  anime: new Set(['search', 'genre', 'sort', 'page', 'collection']),
  paradise: new Set(['search', 'genre', 'page']),
  movies: new Set(['kind', 'search', 'sort', 'page']),
  manga: new Set(['search', 'page']),
};
function catalogueRequest(path) {
  if (typeof path !== 'string' || path.length > 2048) return null;
  const match = /^\/api\/(anime|paradise|movies|manga)\?([^#]+)$/.exec(path);
  if (!match) return null;
  const query = new URLSearchParams(match[2]), page = query.get('page');
  if (!/^[1-9][0-9]?$/.test(page || '') || Number(page) > 50 ||
    [...query.keys()].some(key => !catalogueQueryKeys[match[1]].has(key) || query.getAll(key).length !== 1)) return null;
  return { kind: match[1], page: Number(page) };
}
function catalogueJson(value, request) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || 'error' in value || 'errors' in value ||
    !Array.isArray(value.items) || value.items.length > 20 || !value.pageInfo || Array.isArray(value.pageInfo) ||
    value.pageInfo.page !== request.page || typeof value.pageInfo.hasNextPage !== 'boolean' ||
    (request.kind === 'anime' && !['live', 'curated'].includes(value.source))) return null;
  const validSelector = id => request.kind === 'paradise' ? /^ap_[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(id || '')
    : request.kind === 'manga' ? /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id || '') : validId(id);
  if (value.items.some(item => !item || typeof item !== 'object' || Array.isArray(item) || !validSelector(item.id) ||
    typeof item.title !== 'string' || !item.title.trim() || item.title.length > 300)) return null;
  try {
    const json = JSON.stringify(value);
    return json.length <= 256 * 1024 && new TextEncoder().encode(json).byteLength <= 256 * 1024 ? json : null;
  } catch { return null; }
}

export function createAnimeRequest({ proxyUrl, fetchFn = globalThis.fetch, timeoutMs = 10000, cacheMetadata = false } = {}) {
  const base = proxyBase(proxyUrl);
  const timeout = Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000 ? timeoutMs : 10000;
  const request = async (path, signal) => {
    if (!base || typeof fetchFn !== 'function') throw failure();
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw failure();
    if (signal?.aborted) throw cancelled();
    const url = `${base}${path}`, cacheRequest = cacheMetadata === true ? catalogueRequest(path) : null;
    let cache;
    if (cacheRequest) {
      cache = catalogueCaches.get(fetchFn);
      if (!cache) { cache = new Map(); catalogueCaches.set(fetchFn, cache); }
      const entry = cache.get(url);
      if (entry && entry.until > Date.now()) {
        if (signal?.aborted) throw cancelled();
        cache.delete(url); cache.set(url, entry);
        return JSON.parse(entry.json);
      }
      cache.delete(url);
    }
    const controller = new AbortController(); let timer, abort, timedOut = false;
    const interruption = new Promise((_, reject) => {
      abort = () => { controller.abort(); reject(cancelled()); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      timer = setTimeout(() => { timedOut = true; controller.abort(); reject(failure()); }, timeout);
    });
    try {
      return await Promise.race([interruption, (async () => {
        if (controller.signal.aborted) throw cancelled();
        const response = await fetchFn(url, { method: 'GET', headers: { Accept: 'application/json' },
          credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal });
        if (controller.signal.aborted) throw cancelled();
        if (response.status === 404) throw failure('ANIME_NOT_FOUND');
        if (!response.ok || response.redirected || (response.url && new URL(response.url).href !== new URL(url).href)) throw failure();
        const data = await response.json();
        if (controller.signal.aborted || signal?.aborted) throw cancelled();
        const json = cacheRequest ? catalogueJson(data, cacheRequest) : null;
        if (json) {
          cache.delete(url); cache.set(url, { json, until: Date.now() + 30000 });
          while (cache.size > 20) cache.delete(cache.keys().next().value);
          return JSON.parse(json);
        }
        return data;
      })()]);
    } catch (error) {
      if (signal?.aborted || (error?.name === 'AbortError' && !timedOut)) throw cancelled();
      throw failure(error?.code === 'ANIME_NOT_FOUND' ? 'ANIME_NOT_FOUND' : 'ANIME_UNAVAILABLE');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
  return request;
}

export function createAnimeApi(options = {}) {
  const request = createAnimeRequest({ cacheMetadata: true, ...options });
  return {
    list: async (options = {}, { signal } = {}) => {
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw failure();
      const { search = '', genre = '', sort = 'trending', page = 1, collection = 'all' } = options;
      if (typeof search !== 'string' || search.length > 80 || hasControl(search) ||
        typeof genre !== 'string' || (genre && !GENRES.has(genre)) || !SORTS.has(sort) ||
        !Number.isInteger(page) || page < 1 || page > 50 || !['all', 'official'].includes(collection)) throw failure();
      const parameters = new URLSearchParams({ search: search.trim(), genre, sort, page: String(page), collection });
      const data = await request(`/api/anime?${parameters}`, signal);
      if (!data || !Array.isArray(data.items) || !data.pageInfo || data.pageInfo.page !== page ||
        typeof data.pageInfo.hasNextPage !== 'boolean' || !['live', 'curated'].includes(data.source)) throw failure();
      const seen = new Set();
      const items = data.items.slice(0, 12).map(normalizeAnime).filter(item => {
        if (!item || seen.has(item.id)) return false;
        seen.add(item.id); return true;
      });
      return { items, pageInfo: { page, hasNextPage: data.pageInfo.hasNextPage }, source: data.source, notice: text(data.notice, 500) };
    },
    details: async (id, { signal } = {}) => {
      if (!validId(id)) throw failure();
      const item = normalizeAnime(await request(`/api/anime/${id}`, signal));
      if (!item || item.id !== id) throw failure();
      return item;
    },
  };
}
