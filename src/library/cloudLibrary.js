import { normalizeLibrary, recordViewing, toggleWishlist, removeViewing } from './viewingLibrary';

const message = 'Your cloud library is unavailable. Please try again.';
const itemsFrom = value => normalizeLibrary(value && typeof value === 'object' ? Object.values(value) : []);
const itemMap = items => Object.fromEntries(normalizeLibrary(items).map((item, index) => [String(index), item]));

export function createCloudLibrary({ db, uid, sdk, onItems, onError = () => {} }) {
  if (typeof uid !== 'string' || !uid.length || uid.length > 128 || uid.split('').some(char =>
    '.#$[]/'.includes(char) || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new Error('A valid account is required for your cloud library.');
  }
  const target = sdk.ref(db, `accounts/${uid}/library`);
  const mutate = async operation => {
    try {
      const result = await sdk.runTransaction(target, current => itemMap(operation(itemsFrom(current))));
      if (result?.committed === false) throw new Error(message);
      return itemsFrom(result?.snapshot?.val());
    } catch {
      onError(message);
      throw new Error(message);
    }
  };
  return {
    subscribe: () => {
      let active = true, unsubscribe = () => {};
      try {
        unsubscribe = sdk.onValue(target, snapshot => {
          if (active) onItems(itemsFrom(snapshot.val()));
        }, () => { if (active) onError(message); });
      } catch { onError(message); }
      return () => { if (active) { active = false; unsubscribe(); } };
    },
    record: media => mutate(items => recordViewing(items, media)),
    toggle: media => mutate(items => toggleWishlist(items, { source: media?.source, id: media?.id, title: media?.title })),
    remove: (media, mode) => mutate(items => removeViewing(items, { source: media?.source, id: media?.id, title: media?.title }, mode)),
    clearHistory: () => mutate(items => items.filter(item => item.wishlist)
      .map(item => ({ ...item, position: 0, duration: 0, completed: false, lastWatchedAt: 0 }))),
    importGuest: items => {
      const guest = normalizeLibrary(items);
      return mutate(remote => normalizeLibrary([...remote, ...guest]));
    },
  };
}
