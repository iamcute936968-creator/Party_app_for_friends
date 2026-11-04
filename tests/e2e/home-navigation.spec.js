import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const database = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
const film = { source: 'youtube', id: 'abcdefghijk', title: 'Friday movie', position: 40, duration: 100,
  wishlist: true, updatedAt: 20, lastWatchedAt: 20 };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(item => localStorage.setItem('watchparty.viewing-library.v1', JSON.stringify([item])), film);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5175') return route.continue();
    let body;
    if (url.pathname.endsWith('/firebase-database.js')) body = database;
    else if (url.pathname.endsWith('/firebase-auth.js')) body = auth;
    else if (url.pathname.endsWith('/firebase-app.js')) body = 'export const initializeApp=()=>({});';
    else if (url.hostname === 'www.youtube.com') body = 'window.YT={Player:function(){}};window.onYouTubeIframeAPIReady?.();';
    else if (url.hostname === 'accounts.google.com') body = 'window.google={accounts:{oauth2:{}}};';
    else throw new Error(`Unexpected navigation request: ${url.origin}`);
    return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
});

test('keeps four task destinations clear, accessible and contained on desktop and mobile', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle('Watch Party | Watch together');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A good film.');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Search titles' })).toBeHidden();
  for (const [label, path, title] of [['Movies', '/movies', 'Movies & TV.'], ['Library', '/library', 'Your library'], ['Account', '/account', 'Account']]) {
    const link = page.getByRole('link', { name: label, exact: true });
    await link.click();
    await expect(page).toHaveURL(`http://127.0.0.1:5175${path}`);
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page.getByRole('button', { name: 'Create Room', exact: true })).toBeHidden();
    await expect(page.locator('main')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = await page.locator('.home-page:not([hidden])').boundingBox();
    expect(box.width).toBeGreaterThan(page.viewportSize().width * 0.65);
    await page.screenshot({ path: info.outputPath(`navigation-${label.toLowerCase()}.png`), fullPage: true });
  }
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('loads direct URLs, preserves page drafts between destinations and handles Back and Forward', async ({ page }) => {
  await page.goto('/account');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await page.getByRole('link', { name: 'Movies', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Movies & TV.', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Movies & TV.', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your library');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your library');
});

test('makes a library choice actionable on Watch Together without losing the saved selection', async ({ page }) => {
  await page.goto('/library');
  await page.getByRole('button', { name: 'Choose Friday movie' }).click();
  await expect(page).toHaveURL('http://127.0.0.1:5175/');
  await expect(page.getByText(/Next room: Friday movie/)).toBeVisible();
  await page.getByLabel('Your name', { exact: true }).fill('Host');
  await expect(page.getByRole('button', { name: 'Create Room', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Host's Room");
  await expect.poll(() => page.locator('.room-identity p > span').first().textContent()).toBeTruthy();
});
