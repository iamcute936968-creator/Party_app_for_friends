import { expect, it } from 'vitest';
import { parseMediaLink, normalizeLibrary, recordViewing, toggleWishlist, removeViewing, mediaLink } from '../../src/library/viewingLibrary';
it('stores canonical media identifiers without URL credentials or room invitations', () => {
  const item = parseMediaLink('https://www.youtube.com/watch?v=abcdefghijk&token=private');
  expect(item).toEqual({ source: 'youtube', id: 'abcdefghijk' });
  expect(mediaLink(item)).toBe('https://www.youtube.com/watch?v=abcdefghijk');
  for (const url of ['javascript:alert(1)', 'https://youtube.com.evil.example/watch?v=abcdefghijk', 'https://partyapp-fun.netlify.app/?room=A&s=secret']) expect(parseMediaLink(url)).toBeNull();
});
it('persists resume position, marks completion and retains a wishlist through progress updates', () => {
  const media = { source: 'youtube', id: 'abcdefghijk', title: 'Our movie' };
  let items = toggleWishlist([], media, 1);
  items = recordViewing(items, { ...media, position: 40, duration: 100 }, 2);
  expect(items[0]).toMatchObject({ wishlist: true, position: 40, completed: false, lastWatchedAt: 2 });
  expect(toggleWishlist(items, { ...media, title: 'Custom title' }, 3)[0].title).toBe('Custom title');
  items = recordViewing(items, { ...media, position: 110, duration: 100 }, 3);
  expect(items[0]).toMatchObject({ position: 100, completed: true });
  expect(recordViewing(items, { ...media, position: 40, duration: 100 }, 1793000000000)[0].lastWatchedAt).toBe(1793000000000);
});
it('bounds history and rejects corrupted stored entries instead of retaining unknown private fields', () => {
  const input = Array.from({ length: 70 }, (_, n) => ({ source: 'drive', id: `file_${n}`, title: 'Movie', position: n, duration: 100, secret: 'private', lastWatchedAt: n + 1 }));
  expect(normalizeLibrary(input)).toHaveLength(50);
  expect(JSON.stringify(normalizeLibrary(input))).not.toContain('private');
  expect(normalizeLibrary([null, { source: 'youtube', id: '../bad' }, { ...input[0], position: Infinity }])).toEqual([]);
});
it('removes custom items from history and continue watching while preserving independent wishlist', () => {
  const media = { source: 'youtube', id: 'abcdefghijk', title: 'Our movie' };
  let items = toggleWishlist([], media, 1);
  items = recordViewing(items, { ...media, position: 40, duration: 100 }, 2);
  const clearedWatch = removeViewing(items, media, 'History', 3);
  expect(clearedWatch[0]).toMatchObject({ wishlist: true, position: 0, duration: 0, lastWatchedAt: 0 });
  const clearedWishlist = removeViewing(items, media, 'Wishlist', 3);
  expect(clearedWishlist[0]).toMatchObject({ wishlist: false, position: 40, lastWatchedAt: 2 });
  const watchedOnly = recordViewing([], { ...media, position: 40, duration: 100 }, 2);
  expect(removeViewing(watchedOnly, media, 'History', 3)).toEqual([]);
});
