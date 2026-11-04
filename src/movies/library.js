import { movieSelection, validMovieId } from './selection';
const message = 'Your movie library could not be updated. Please try again.';
export const movieKey = item => `${item.kind}/${item.id}`;
const number = (value, max) => Number.isFinite(value) && value >= 0 && value <= max;
export function normalizeMovieLibrary(value) {
  const seen = new Set();
  return Object.values(value && typeof value === 'object' ? value : {}).filter(item => item && ['movie', 'tv'].includes(item.kind) && validMovieId(item.id) && typeof item.title === 'string' && item.title.trim() &&
    typeof item.wishlist === 'boolean' && typeof item.completed === 'boolean' && number(item.position, 604800) && number(item.duration, 604800) && item.position <= item.duration &&
    Number.isInteger(item.season) && item.season >= 0 && item.season <= 9999 && Number.isInteger(item.episode) && item.episode >= 0 && item.episode <= 9999 &&
    (item.kind !== 'movie' || (item.season === 0 && item.episode === 0)) && number(item.updatedAt, 1e14) && number(item.lastWatchedAt, 1e14) && (item.wishlist || item.lastWatchedAt > 0) &&
    (item.lastWatchedAt > 0 ? item.duration > 0 && (item.kind !== 'tv' || item.episode > 0) : item.position === 0 && item.duration === 0 && item.season === 0 && item.episode === 0 && !item.completed))
    .map(item => ({ kind: item.kind, id: item.id, title: item.title.trim().slice(0, 120), wishlist: item.wishlist, position: item.position, duration: item.duration, season: item.season, episode: item.episode, completed: item.completed, updatedAt: item.updatedAt, lastWatchedAt: item.lastWatchedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt).filter(item => { const key = movieKey(item); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 50);
}
export function updateMovieLibrary(items, action, value, now = Date.now(), options = {}) {
  if (!movieSelection(value) || !['toggle', 'record', 'remove'].includes(action)) throw new Error(message);
  const current = normalizeMovieLibrary(items), previous = current.find(item => movieKey(item) === movieKey(value));
  const candidate = { kind: value.kind, id: value.id, title: value.title || previous?.title, wishlist: previous?.wishlist || false, position: previous?.position || 0, duration: previous?.duration || 0,
    season: previous?.season || 0, episode: previous?.episode || 0, completed: previous?.completed || false, lastWatchedAt: previous?.lastWatchedAt || 0, updatedAt: now };
  if (action === 'record') {
    const selection = movieSelection(value, true);
    if (!selection || !number(value.position, 604800) || !number(value.duration, 604800) || value.duration <= 0 || value.position > value.duration) throw new Error(message);
    Object.assign(candidate, { position: value.position, duration: value.duration, season: selection.season, episode: selection.episode, completed: value.completed === true, lastWatchedAt: now });
  } else if (action === 'toggle') {
    candidate.wishlist = !candidate.wishlist;
  } else if (action === 'remove') {
    const mode = (options?.mode || value?.mode || '').toLowerCase();
    if (mode === 'wishlist') {
      candidate.wishlist = false;
    } else if (mode === 'history' || mode === 'continue watching') {
      candidate.position = 0; candidate.duration = 0; candidate.season = 0; candidate.episode = 0; candidate.completed = false; candidate.lastWatchedAt = 0;
    } else {
      candidate.wishlist = false;
      candidate.position = 0; candidate.duration = 0; candidate.season = 0; candidate.episode = 0; candidate.completed = false; candidate.lastWatchedAt = 0;
    }
  }
  const result = normalizeMovieLibrary([candidate, ...current.filter(item => movieKey(item) !== movieKey(candidate))]);
  if ((candidate.wishlist || candidate.lastWatchedAt > 0) && !result.some(item => movieKey(item) === movieKey(candidate))) throw new Error(message);
  return result;
}
export function createMovieLibrary({ db, uid, sdk, onItems = () => {}, onError = () => {} }) {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error(message);
  const target = sdk.ref(db, `accounts/${uid}/movieLibrary`), report = () => onError(message);
  const mutate = async operation => { try { const result = await sdk.runTransaction(target, value => {
    const items = operation(normalizeMovieLibrary(value)); return items.length ? Object.fromEntries(items.map((item, index) => [String(index), item])) : null;
  }); if (result?.committed === false || typeof result?.snapshot?.val !== 'function') throw new Error(message); return normalizeMovieLibrary(result.snapshot.val());
  } catch { report(); throw new Error(message); } };
  return {
    subscribe: () => { let active = true, stop = () => {}; try { stop = sdk.onValue(target, snapshot => { if (active) onItems(normalizeMovieLibrary(snapshot.val())); }, () => { if (active) report(); }) || stop; } catch { active = false; report(); }
      return () => { active = false; stop(); }; },
    toggle: item => mutate(items => updateMovieLibrary(items, 'toggle', item)), record: item => mutate(items => updateMovieLibrary(items, 'record', item)),
    remove: (item, options) => mutate(items => updateMovieLibrary(items, 'remove', item, Date.now(), options)), importGuest: items => mutate(remote => normalizeMovieLibrary([...remote, ...normalizeMovieLibrary(items)])),
  };
}
