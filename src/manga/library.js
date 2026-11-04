import { validMangaId } from './api';
const error = () => new Error('Could not update your manga library. Please try again.');
export function normalizeMangaLibrary(value) {
  const seen = new Set();
  return Object.values(value && typeof value === 'object' ? value : {}).filter(item => item && validMangaId(item.id) && typeof item.title === 'string' && item.title.trim() &&
    (item.chapterId === '' || validMangaId(item.chapterId)) && Number.isInteger(item.page) && item.page >= 0 && item.page <= 499 &&
    (item.chapterId || item.page === 0) && typeof item.saved === 'boolean' && (item.saved || item.chapterId) && Number.isFinite(item.updatedAt) && item.updatedAt >= 0 && item.updatedAt <= 1e14)
    .map(item => ({ id: item.id, title: item.title.trim().slice(0, 120), chapterId: item.chapterId, page: item.page, saved: item.saved, updatedAt: item.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt).filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }).slice(0, 50);
}
export function updateMangaLibrary(items, action, value, now = Date.now()) {
  const current = normalizeMangaLibrary(items), previous = current.find(item => item.id === value?.id);
  if (!validMangaId(value?.id) || !['record', 'toggle', 'remove'].includes(action)) throw error();
  const candidate = { id: value.id, title: value.title || previous?.title, chapterId: previous?.chapterId || '', page: previous?.page || 0, saved: previous?.saved || false, updatedAt: now };
  if (action === 'record') { if (!validMangaId(value.chapterId) || !Number.isInteger(value.page) || value.page < 0 || value.page > 499) throw error(); candidate.chapterId = value.chapterId; candidate.page = value.page; }
  if (action === 'toggle') candidate.saved = !candidate.saved;
  if (action === 'remove') candidate.saved = false;
  return normalizeMangaLibrary([candidate, ...current.filter(item => item.id !== value.id)]);
}
export function createMangaLibrary({ db, uid, sdk, onItems = () => {}, onError = () => {} }) {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw error();
  const target = sdk.ref(db, `accounts/${uid}/mangaLibrary`);
  const map = items => { const values = normalizeMangaLibrary(items); return values.length ? Object.fromEntries(values.map((item, index) => [String(index), item])) : null; };
  const mutate = async operation => {
    try { const result = await sdk.runTransaction(target, value => map(operation(normalizeMangaLibrary(value))));
      if (result?.committed === false || typeof result?.snapshot?.val !== 'function') throw error(); return normalizeMangaLibrary(result.snapshot.val());
    } catch { onError(error().message); throw error(); }
  };
  return {
    subscribe: () => { let active = true; const stop = sdk.onValue(target, snapshot => { if (active) onItems(normalizeMangaLibrary(snapshot.val())); }, () => { if (active) onError(error().message); });
      return () => { active = false; stop?.(); }; },
    toggle: item => mutate(current => updateMangaLibrary(current, 'toggle', item)),
    record: item => mutate(current => updateMangaLibrary(current, 'record', item)),
    remove: id => mutate(current => updateMangaLibrary(current, 'remove', { id })),
    importGuest: items => mutate(current => normalizeMangaLibrary([...current, ...normalizeMangaLibrary(items)])),
  };
}
