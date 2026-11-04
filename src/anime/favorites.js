const message = 'Your saved anime could not be updated.';
const validId = value => typeof value === 'string' && ((/^[1-9][0-9]{0,9}$/.test(value) && Number(value) <= 2147483647) || /^ap_[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value));

export function normalizeAnimeFavorites(value) {
  const items = value && typeof value === 'object' ? Object.values(value) : [];
  const seen = new Set();
  return items.filter(item => item && validId(item.id) && typeof item.title === 'string' && item.title.trim() &&
    Number.isFinite(item.updatedAt) && item.updatedAt >= 0 && item.updatedAt <= 1e14)
    .map(item => ({ id: item.id, title: item.title.trim().slice(0, 120), updatedAt: item.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }).slice(0, 50);
}

export function toggleAnimeFavorite(items, title, now = Date.now()) {
  const current = normalizeAnimeFavorites(items);
  const candidate = normalizeAnimeFavorites([{ id: title?.id, title: title?.title, updatedAt: now }])[0];
  if (!candidate) return current;
  return current.some(item => item.id === candidate.id) ? current.filter(item => item.id !== candidate.id)
    : normalizeAnimeFavorites([candidate, ...current]);
}

export function createAnimeFavorites({ db, uid, sdk, onItems = () => {}, onError = () => {}, collection = 'animeFavorites' }) {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('A valid account is required for saved anime.');
  if (!['animeFavorites', 'paradiseFavorites'].includes(collection)) throw new Error(message);
  const target = sdk.ref(db, `accounts/${uid}/${collection}`);
  const reportError = () => { try { onError(message); } catch { /* Keep persistence failures generic. */ } };
  const itemMap = value => {
    const normalized = normalizeAnimeFavorites(value);
    return normalized.length ? Object.fromEntries(normalized.map((item, index) => [String(index), item])) : null;
  };
  const mutate = async operation => {
    try {
      const result = await sdk.runTransaction(target, current => itemMap(operation(normalizeAnimeFavorites(current))));
      if (result?.committed === false || typeof result?.snapshot?.val !== 'function') throw new Error(message);
      return normalizeAnimeFavorites(result.snapshot.val());
    } catch { reportError(); throw new Error(message); }
  };
  return {
    subscribe: () => {
      let active = true, unsubscribe = () => {};
      try {
        const stop = sdk.onValue(target, snapshot => {
          if (!active) return;
          try { onItems(normalizeAnimeFavorites(snapshot.val())); } catch { reportError(); }
        }, () => { if (active) reportError(); });
        if (typeof stop === 'function') unsubscribe = stop;
      } catch { active = false; reportError(); }
      return () => { if (active) { active = false; try { unsubscribe(); } catch { /* Cleanup is idempotent. */ } } };
    },
    toggle: (title, now = Date.now()) => mutate(current => toggleAnimeFavorite(current, title, now)),
    remove: id => mutate(current => current.filter(item => item.id !== id)),
    importGuest: items => {
      const guest = normalizeAnimeFavorites(items);
      return mutate(remote => normalizeAnimeFavorites([...remote, ...guest]));
    },
  };
}
