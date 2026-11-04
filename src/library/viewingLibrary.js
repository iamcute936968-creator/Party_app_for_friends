export const LIBRARY_KEY = 'watchparty.viewing-library.v1';
export const mediaKey = (item) => `${item.source}/${item.id}`;
const valid = (item) => item && ['youtube', 'drive'].includes(item.source) && typeof item.id === 'string' &&
  (item.source === 'youtube' ? /^[\w-]{11}$/ : /^[\w-]{1,200}$/).test(item.id);
const number = (value, fallback = 0) => Number.isFinite(value) && value >= 0 ? Math.min(value, 1e10) : fallback;
export function normalizeLibrary(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter(item => valid(item) && (item.position === undefined || Number.isFinite(item.position)))
    .map(item => ({ source: item.source, id: item.id,
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 120) : `${item.source === 'youtube' ? 'YouTube' : 'Google Drive'} · ${item.id}`,
      position: number(item.position), duration: number(item.duration), wishlist: item.wishlist === true,
      completed: item.completed === true, updatedAt: Number.isFinite(item.updatedAt) ? Math.max(0, item.updatedAt) : 0,
      lastWatchedAt: Number.isFinite(item.lastWatchedAt) ? Math.max(0, item.lastWatchedAt) : 0 }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(item => { const key = mediaKey(item); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 50);
}
export function parseMediaLink(input) {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    let item;
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      item = { source: 'youtube', id: url.searchParams.get('v') || /^\/(?:shorts|embed)\/([^/]+)/.exec(url.pathname)?.[1] };
    } else if (url.hostname === 'youtu.be') item = { source: 'youtube', id: url.pathname.slice(1) };
    else if (url.hostname === 'drive.google.com') item = { source: 'drive', id: /\/file\/d\/([^/]+)/.exec(url.pathname)?.[1] || url.searchParams.get('id') };
    return valid(item) ? item : null;
  } catch { return null; }
}
export const mediaLink = (item) => valid(item) ? (item.source === 'youtube'
  ? `https://www.youtube.com/watch?v=${item.id}` : `https://drive.google.com/file/d/${item.id}/view`) : '';
export function recordViewing(items, media, now = Date.now()) {
  if (!valid(media) || !Number.isFinite(media.position) || media.position < 0) return items;
  const old = items.find(item => mediaKey(item) === mediaKey(media));
  const duration = number(media.duration);
  const position = Math.min(number(media.position), duration || Infinity);
  return normalizeLibrary([{ ...old, ...media, title: media.title || old?.title,
    position, duration, completed: duration > 0 && position >= duration * 0.95,
    wishlist: old?.wishlist === true, lastWatchedAt: now, updatedAt: now }, ...items.filter(item => mediaKey(item) !== mediaKey(media))]);
}
export function toggleWishlist(items, media, now = Date.now()) {
  if (!valid(media)) return items;
  const old = items.find(item => mediaKey(item) === mediaKey(media));
  return normalizeLibrary([{ ...old, ...media, title: media.title || old?.title, wishlist: !old?.wishlist, updatedAt: now },
    ...items.filter(item => mediaKey(item) !== mediaKey(media))]);
}
export function removeViewing(items, media, mode = 'Wishlist', now = Date.now()) {
  if (!valid(media)) return items;
  const old = items.find(item => mediaKey(item) === mediaKey(media));
  if (!old) return items;
  const tab = (mode || '').toLowerCase();
  const updated = tab === 'wishlist'
    ? { ...old, wishlist: false, updatedAt: now }
    : { ...old, position: 0, duration: 0, completed: false, lastWatchedAt: 0, updatedAt: now };
  const filtered = items.filter(item => mediaKey(item) !== mediaKey(media));
  if (!updated.wishlist && updated.lastWatchedAt === 0) return filtered;
  return normalizeLibrary([updated, ...filtered]);
}
