import { readFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { expect, test } from '@playwright/test';

const clip = await readFile(new URL('../fixtures/playback.mp4', import.meta.url));
test('real Room video loads, plays, pauses and seeks to a visibly different frame', async ({ page, browserName }, testInfo) => {
  test.skip(browserName === 'webkit' && platform() === 'win32', 'This Windows WebKit build returns MEDIA_ERR_SRC_NOT_SUPPORTED for the local H.264 fixture; media playback needs a supported platform. UI tests still run.');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__test/playback.mp4', (route) => {
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4',
      headers: { 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${clip.length}` } : {}) },
      body: clip.subarray(start, end + 1) });
  });
  await page.goto('/tests/e2e/media-harness.html');
  const video = page.locator('video').first();
  await expect(page.getByRole('heading', { name: 'Local playback' })).toBeVisible();
  await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(1);
  await expect.poll(() => video.evaluate((element) => element.duration)).toBeCloseTo(4, 1);
  await expect(page.getByRole('slider', { name: 'Video timeline' })).toBeEnabled();
  const frame = () => video.evaluate((element) => {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 18;
    canvas.getContext('2d').drawImage(element, 0, 0, 32, 18);
    return canvas.toDataURL();
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(.25);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(true);
  const pausedAt = await video.evaluate((element) => element.currentTime);
  await page.waitForTimeout(350);
  expect(await video.evaluate((element) => element.currentTime)).toBeCloseTo(pausedAt, 1);
  const firstFrame = await frame();
  const slider = page.getByRole('slider', { name: 'Video timeline' });
  const bounds = await slider.boundingBox();
  await slider.click({ position: { x: bounds.width * .6, y: bounds.height / 2 } });
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(2);
  await expect.poll(() => video.evaluate((element) => element.seeking)).toBe(false);
  expect(await frame()).not.toEqual(firstFrame);
  await page.screenshot({ path: testInfo.outputPath('real-video-seek.png'), fullPage: true });
  expect(errors).toEqual([]);
});
