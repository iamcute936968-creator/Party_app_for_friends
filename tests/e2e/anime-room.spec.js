import { readFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { expect, test } from '@playwright/test';
import { fulfillAnimeFixture } from '../helpers/anime-hls-fixture';
const database = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
test('creates an anime room, controls real HLS, changes episode and releases playback on leave', async ({ page, browserName }, info) => {
  test.skip(browserName === 'webkit' && platform() === 'win32', 'Windows WebKit cannot decode the H.264 fixture; non-media anime UI tests run separately.');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    if (await fulfillAnimeFixture(route)) return;
    const url = new URL(route.request().url()); if (url.origin === 'http://127.0.0.1:5175') return route.continue();
    const body = url.pathname.endsWith('/firebase-database.js') ? database : url.pathname.endsWith('/firebase-auth.js') ? auth
      : url.pathname.endsWith('/firebase-app.js') ? 'export const initializeApp=()=>({});' : url.hostname === 'www.youtube.com'
        ? 'window.YT={};window.onYouTubeIframeAPIReady?.();' : url.hostname === 'accounts.google.com' ? 'window.google={accounts:{oauth2:{}}};' : '';
    await route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
  await page.goto('/anime/ap_naruto');
  await page.getByRole('button', { name: 'Watch together', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:5175/');
  await page.getByLabel('Your name', { exact: true }).fill('Host');
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await page.evaluate(() => window.setTestConnection(true));
  const video = page.getByLabel('Room video', { exact: true });
  await expect(page.getByRole('button', { name: 'Watch episode 1', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => video.evaluate(el => el.videoWidth)).toBeGreaterThan(0);
  await expect.poll(() => video.evaluate(el => el.currentTime)).toBeGreaterThan(.3);
  const roomId = await page.locator('.room-identity p > span').first().textContent();
  // A local native decoder failure must not publish the engine's reset as a host pause.
  await video.evaluate(el => {
    Object.defineProperty(el, 'error', { configurable: true, value: { code: 3 } });
    el.dispatchEvent(new Event('error')); delete el.error;
  });
  await expect.poll(() => video.evaluate(el => el.src.startsWith('blob:') && el.readyState >= 2)).toBe(true);
  await expect.poll(() => page.evaluate(id => window.testRoomAnime(id), roomId)).toMatchObject({ playbackState: 'PLAYING' });
  await expect.poll(() => video.evaluate(el => !el.paused && el.currentTime > .3)).toBe(true);
  await page.getByRole('button', { name: 'Pause', exact: true }).click(); await expect.poll(() => video.evaluate(el => el.paused)).toBe(true);
  const slider = page.getByRole('slider', { name: 'Video timeline' }), bounds = await slider.boundingBox();
  await slider.click({ position: { x: bounds.width * .55, y: bounds.height / 2 } });
  await expect.poll(() => video.evaluate(el => el.currentTime)).toBeGreaterThan(9);
  const id = await page.locator('.room-identity p > span').first().textContent();
  await page.evaluate(() => {
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!window.releaseAnimePlay) return new Promise(resolve => { window.releaseAnimePlay = resolve; });
      return nativePlay.call(this);
    };
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => typeof window.releaseAnimePlay === 'function');
  await page.getByRole('button', { name: 'Watch episode 2', exact: true }).click();
  await expect.poll(() => video.evaluate(el => el.currentTime)).toBeLessThan(1);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.evaluate(() => window.releaseAnimePlay());
  await expect.poll(() => page.evaluate(id => window.testRoomAnime(id), id)).toMatchObject({ episode: 2, playbackState: 'PAUSED', anchorTime: 0, privateUrlStored: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('anime-room.png'), fullPage: false });
  await page.getByRole('button', { name: 'Leave room', exact: true }).click();
  await expect(page.getByLabel('Room video', { exact: true })).toHaveCount(0); expect(errors).toEqual([]);
});
