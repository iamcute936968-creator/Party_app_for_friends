import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
const database = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
const id = '58be6aa6-06cb-4ca5-bd20-f1392ce451fb', chapterId = 'ff4f79de-6102-4610-8327-539904cfe549';
const item = { id, title: 'Reader test story', description: 'A gentle story for a quiet evening.', authors: ['Test author'], genres: ['Slice of life'], year: 2003, status: 'ongoing' };
const chapter = { id: chapterId, mangaId: id, number: '1.5', title: 'A new day', pageCount: 5, external: false, groups: [{ id, name: 'Test scanlation group' }] };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+rK1kAAAAASUVORK5CYII=', 'base64');
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()); let body;
    if (url.pathname.startsWith('/__test/media-proxy/api/manga')) {
      const suffix = url.pathname.split('/api/manga')[1];
      if (suffix.endsWith('/cover') || suffix.includes('/pages/')) return route.fulfill({ contentType: 'image/png', body: png });
      const json = suffix === '' ? { items: [item], pageInfo: { page: 1, hasNextPage: false } }
        : suffix.endsWith('/navigation') ? { items: [{ id: chapterId, number: '1.5', volume: '1', aliases: [] }] }
        : suffix.endsWith(`/chapters/${chapterId}`) ? chapter : suffix.endsWith('/chapters') ? { items: [chapter], pageInfo: { page: 1, hasNextPage: false } } : item;
      return route.fulfill({ json });
    }
    if (url.origin === 'http://127.0.0.1:5175') return route.continue();
    if (url.pathname.endsWith('/firebase-database.js')) body = database;
    else if (url.pathname.endsWith('/firebase-auth.js')) body = auth;
    else if (url.pathname.endsWith('/firebase-app.js')) body = 'export const initializeApp=()=>({});';
    else if (url.hostname === 'www.youtube.com') body = 'window.YT={Player:function(){}};window.onYouTubeIframeAPIReady?.();';
    else if (url.hostname === 'accounts.google.com') body = 'window.google={accounts:{oauth2:{}}};';
    else throw Error(`Unexpected external request: ${url.origin}`);
    return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
});
test('browse, save, read, change page and reload a manga on desktop and mobile', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/manga');
  await expect(page.getByRole('heading', { name: 'Find your next manga.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveCount(5);
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Anime', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('searchbox').fill('Reader'); await page.getByRole('button', { name: 'Search manga', exact: true }).click();
  await page.getByRole('button', { name: 'Save Reader test story', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unsave Reader test story', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Saved manga', exact: true }).click();
  await page.screenshot({ path: info.outputPath('manga-saved.png'), fullPage: true });
  await page.getByRole('button', { name: 'Details for Reader test story' }).click();
  await expect(page).toHaveURL(new RegExp(`/manga/${id}$`));
  await page.getByRole('button', { name: 'Read chapter 1.5' }).click();
  await expect(page.getByRole('img', { name: 'Page 1 of 5', exact: true })).toBeVisible();
  const reader = await page.getByRole('region', { name: 'Manga reader' }).boundingBox();
  expect(reader.width).toBeGreaterThan(page.viewportSize().width < 650 ? page.viewportSize().width * .85 : 900);
  await page.screenshot({ path: info.outputPath('ux-manga.png'), fullPage: false });
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('watchparty.manga-library.v1'))[0]?.page)).toBe(1);
  await page.reload();
  await expect(page.getByRole('img', { name: 'Page 2 of 5', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Test scanlation group' })).toHaveAttribute('href', `https://mangadex.org/group/${id}`);
  await page.getByLabel('Go to page', { exact: true }).fill('5'); await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.getByText('End of chapter.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('watchparty.manga-library.v1'))[0]?.page)).toBe(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('manga-reader.png'), fullPage: true });
  await page.getByRole('button', { name: 'All chapters', exact: true }).click();
  await page.getByRole('button', { name: 'Browse manga', exact: true }).click();
  await page.getByRole('button', { name: 'Continue reading', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume at page 5' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('failed page keeps the last good bookmark and can be retried without leaving the reader', async ({ page }) => {
  let failures = 1;
  await page.route(`**/api/manga/${id}/chapters/${chapterId}/pages/1?*`, route => failures-- > 0 ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.fulfill({ contentType: 'image/png', body: png }));
  await page.goto(`/manga/${id}/read/${chapterId}`);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('watchparty.manga-library.v1'))?.[0]?.page)).toBe(0);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry page 2', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('watchparty.manga-library.v1'))[0].page)).toBe(0);
  await page.getByRole('button', { name: 'Retry page 2', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('watchparty.manga-library.v1'))[0]?.page)).toBe(1);
});
test('invalid manga addresses fail without opening a reader', async ({ page }) => {
  await page.goto('/manga/not-a-title/read/bad');
  await expect(page.getByRole('heading', { name: 'Manga unavailable' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Manga reader' })).toHaveCount(0);
});
import { Buffer } from 'node:buffer';
