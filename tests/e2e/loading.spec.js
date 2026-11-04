import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
const database = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.pathname.includes('/__test/media-proxy/')) return route.fulfill({ json: { items: [], pageInfo: { page: 1, hasNextPage: false } } });
    if (u.origin === 'http://127.0.0.1:5175') return route.continue();
    const body = u.pathname.endsWith('/firebase-database.js') ? database : u.pathname.endsWith('/firebase-auth.js') ? auth : u.pathname.endsWith('/firebase-app.js') ? 'export const initializeApp=()=>({});' : u.hostname === 'www.youtube.com' ? 'window.YT={Player:function(){}};window.onYouTubeIframeAPIReady?.();' : u.hostname === 'accounts.google.com' ? 'window.google={accounts:{oauth2:{}}};' : null;
    return body === null ? route.abort() : route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
});
test('shows a startup skeleton before JavaScript is ready', async ({ page, browserName }, info) => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/src/main.jsx', async route => { await gate; await route.continue(); });
  await page.goto('/movies', { waitUntil: 'commit' });
  await expect(page.getByRole('status', { name: 'Loading Watch Party', exact: true })).toBeVisible();
  // Windows WebKit screenshots wait for the deliberately held module request.
  if (browserName !== 'webkit') await page.screenshot({ path: info.outputPath('skeleton-startup.png') });
  release(); await expect(page.getByRole('heading', { name: 'Movies & TV.', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('status', { name: 'Loading Watch Party', exact: true })).toHaveCount(0);
});
test('replaces catalogue and poster skeletons, respecting reduced motion', async ({ page }, info) => {
  let release, releasePoster; const gate = new Promise(resolve => { release = resolve; }), poster = new Promise(resolve => { releasePoster = resolve; });
  await page.route('**/api/movies?*', async route => { await gate; await route.fulfill({ json: { items: [{ id: '10378', title: 'A film', mediaKind: 'movie', cover: 'https://image.tmdb.org/t/p/w500/fixture.jpg', genres: [], seasons: [] }], pageInfo: { page: 1, hasNextPage: false } } }); });
  await page.route('https://image.tmdb.org/**', async route => { await poster; await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#313d48"/></svg>' }); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/movies'); const skeleton = page.locator('.loading-skeleton[data-layout="grid"]');
  await expect(skeleton).toBeVisible(); await expect(skeleton.locator('button,input,a')).toHaveCount(0);
  await expect(skeleton.locator('.skeleton-shape').first()).toHaveCSS('animation-name', 'none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('skeleton-catalogue.png') });
  release(); await expect(page.getByRole('button', { name: 'Details for A film' })).toBeVisible(); await expect(skeleton).toHaveCount(0);
  await expect(page.locator('.poster-image-loading')).toHaveCount(1); releasePoster();
  await expect(page.getByRole('img', { name: 'Poster for A film' })).toHaveCSS('opacity', '1');
  await expect(page.locator('.poster-image-loading')).toHaveCount(0);
});
test('reuses public movie metadata across navigation and fetches a changed search', async ({ page }) => {
  const requests = [];
  await page.route('**/api/movies?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    requests.push(query.toString());
    await route.fulfill({ json: {
      items: [{ id: '10378', title: query.get('search') ? 'Search film' : 'Cached film', mediaKind: 'movie', genres: [], seasons: [] }],
      pageInfo: { page: Number(query.get('page')), hasNextPage: false },
    } });
  });
  await page.goto('/movies');
  await expect(page.getByRole('button', { name: 'Details for Cached film', exact: true })).toBeVisible();
  // Development StrictMode can cancel an initial attempt. The cache contract is
  // no additional request after a successful list has rendered and is remounted.
  const initialAttempts = requests.length;
  expect(initialAttempts).toBeGreaterThanOrEqual(1);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await page.getByRole('link', { name: 'Movies', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Details for Cached film', exact: true })).toBeVisible();
  expect(requests).toHaveLength(initialAttempts);
  await page.getByLabel('Movie or TV title', { exact: true }).fill('Different');
  await page.getByRole('button', { name: 'Search titles', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Details for Search film', exact: true })).toBeVisible();
  expect(requests).toHaveLength(initialAttempts + 1);
  expect(new URLSearchParams(requests.at(-1)).get('search')).toBe('Different');
});
test('loads the home background as a WebP smaller than 100 KB', async ({ page }) => {
  const imageResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/assets/cinema-dusk.webp');
  await page.goto('/');
  const response = await imageResponse;
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('image/webp');
  const body = await response.body();
  expect(body.length).toBeGreaterThan(0);
  expect(body.length).toBeLessThan(100000);
  await expect(page.locator('.home-landscape')).toHaveCSS('background-image', /cinema-dusk\.webp/);
});
