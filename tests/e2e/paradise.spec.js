import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
const database = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
const item = { id: 'ap_naruto', title: 'Naruto', description: 'A young ninja finds his own path.', provider: 'animeparadise',
  genres: ['Action'], year: 2002, totalEpisodes: 220, cover: '', banner: '', links: [], source: 'live',
  episodes: [{ id: '9eb4f092-eac5-4ce6-8a45-0c874f99415e', number: 1, source: 'hls', provider: 'AnimeParadise', language: 'Subtitled', embeddable: true }] };
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/api/paradise')) {
      if (url.pathname.endsWith('/stream')) return route.fulfill({ status: 503, json: { error: 'Provider unavailable' } });
      if (url.pathname.endsWith('/ap_naruto')) return route.fulfill({ json: item });
      return route.fulfill({ json: { items: [item], pageInfo: { page: Number(url.searchParams.get('page') || 1), hasNextPage: false } } });
    }
    if (url.origin === 'http://127.0.0.1:5175') return route.continue();
    const body = url.pathname.endsWith('/firebase-database.js') ? database : url.pathname.endsWith('/firebase-auth.js') ? auth
      : url.pathname.endsWith('/firebase-app.js') ? 'export const initializeApp=()=>({});'
      : url.hostname === 'www.youtube.com' ? 'window.YT={};window.onYouTubeIframeAPIReady?.();'
      : url.hostname === 'accounts.google.com' ? 'window.google={accounts:{oauth2:{}}};' : '';
    return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
});
test('discovers provider anime, toggles the wishlist across reloads and opens it from Library', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/anime');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find your next anime.');
  await page.getByRole('button', { name: 'Add Naruto to wishlist' }).click();
  await expect(page.getByRole('button', { name: 'Remove Naruto from wishlist' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload(); await expect(page.getByRole('button', { name: 'Remove Naruto from wishlist' })).toBeVisible();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Wishlist', exact: true }).click();
  await page.getByRole('button', { name: 'Open Naruto', exact: true }).click();
  await expect(page).toHaveURL(/\/anime\/ap_naruto$/); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Naruto');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('paradise-wishlist.png'), fullPage: false });
  expect(errors).toEqual([]);
});
test('uses provider searches and genres, and retries an unavailable episode without a YouTube redirect', async ({ page }) => {
  const requests = []; page.on('request', req => { if (req.url().includes('/api/paradise?')) requests.push(new URL(req.url())); });
  await page.goto('/anime'); await page.getByRole('searchbox', { name: 'Anime title' }).fill('Naruto');
  await expect.poll(() => requests.at(-1)?.searchParams.get('search')).toBe('Naruto');
  await page.getByRole('combobox', { name: 'Genre' }).selectOption('Action');
  await expect.poll(() => requests.at(-1)?.searchParams.get('genre')).toBe('Action');
  await expect(page.getByRole('combobox', { name: 'Sort' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Details for Naruto' }).click();
  await page.getByRole('button', { name: 'Watch episode 1', exact: true }).first().click();
  await expect(page).toHaveURL(/\/anime\/ap_naruto\/watch\/1$/);
  await expect(page.getByRole('alert')).toContainText('could not play');
  await page.getByRole('button', { name: 'Retry playback' }).click();
  await expect(page.getByRole('alert')).toContainText('could not play');
  await expect(page.getByRole('link', { name: 'Open on YouTube' })).toHaveCount(0);
});
