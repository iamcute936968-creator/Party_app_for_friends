import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { expect, test } from '@playwright/test';

const databaseFixture = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const firebaseAuthFixture = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
const streaming = process.env.VITE_DRIVE_STREAMING !== 'false';

async function openDriveRoom(page, host = false) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5175') return route.continue();
    let body;
    if (url.pathname.endsWith('/firebase-database.js')) body = databaseFixture;
    else if (url.pathname.endsWith('/firebase-auth.js')) body = firebaseAuthFixture;
    else if (url.pathname.endsWith('/firebase-app.js')) body = 'export const initializeApp = () => ({});';
    else if (url.hostname === 'www.youtube.com') body = 'window.YT = {Player: function(){}}; window.onYouTubeIframeAPIReady?.();';
    else if (url.hostname === 'accounts.google.com') body = `window.google = {accounts: {oauth2: {initTokenClient: (options) => ({
      requestAccessToken: () => options.callback({access_token: 'fixture-access-token'})
    })}}};`;
    else throw new Error(`Unexpected external request to ${url.origin}`);
    return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
  await page.addInitScript(({ streaming }) => {
    window.testPreparationMode = 'fail';
    window.testPreparationRequests = [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      const isTicket = url.pathname === '/__test/media-proxy/api/ticket';
      const isDrive = url.hostname === 'www.googleapis.com' && url.pathname.startsWith('/drive/v3/files/');
      if (!isTicket && !isDrive) return nativeFetch(input, init);
      if (isDrive && url.searchParams.get('alt') === 'media') return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-length': '3', 'content-type': 'video/mp4' },
      }));
      const fileId = isTicket ? JSON.parse(init.body).fileId : decodeURIComponent(url.pathname.split('/').pop());
      const record = { fileId, aborted: false };
      window.testPreparationRequests.push(record);
      const response = (success) => new Response(JSON.stringify(success ? (streaming ? {
        mediaUrl: `http://127.0.0.1:5175/__test/media/${fileId}?t=fixture-ticket-${window.testPreparationRequests.length}`, expiresAt: Date.now() + (window.testTicketLifetimeMs || 3600000),
      } : { name: fileId, mimeType: 'video/mp4', size: '3' }) : { error: 'Video preparation failed. Try again.' }), {
        status: success ? 200 : 503, headers: { 'content-type': 'application/json' },
      });
      if (window.testPreparationMode !== 'hold') return Promise.resolve(response(window.testPreparationMode === 'success'));
      return new Promise((resolve, reject) => {
        window.releaseTestPreparation = (success = true) => resolve(response(success));
        init.signal.addEventListener('abort', () => {
          record.aborted = true;
          reject(new DOMException('Fixture request cancelled', 'AbortError'));
        }, { once: true });
      });
    };
    // Only the media-element boundary is controlled here. Actual decoding/playback
    // remains covered separately by media-playback.spec.js with a real local clip.
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true, get() { return this.dataset.fixtureSrc || ''; },
      set(value) { this.dataset.fixtureSrc = value; },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get: () => 60 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => window.testNoVideoTrack ? 0 : 1280 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => window.testNoVideoTrack ? 0 : 720 });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get() { return this.dataset.fixtureReady === 'true' ? 4 : 0; } });
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return this.dataset.fixturePaused !== 'false'; } });
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true, get() { return Number(this.dataset.fixtureTime || 0); },
      set(value) { this.dataset.fixtureTime = value; this.dispatchEvent(new Event('seeking')); queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); },
    });
    HTMLMediaElement.prototype.removeAttribute = function(name) {
      if (name === 'src') { delete this.dataset.fixtureSrc; delete this.dataset.fixtureReady; }
      Element.prototype.removeAttribute.call(this, name);
    };
    HTMLMediaElement.prototype.load = function() {
      if (this.dataset.fixtureSrc) queueMicrotask(() => {
        this.dataset.fixtureReady = 'true';
        this.dispatchEvent(new Event('loadedmetadata'));
      });
    };
    HTMLMediaElement.prototype.pause = function() {
      const wasPlaying = this.dataset.fixturePaused === 'false';
      this.dataset.fixturePaused = 'true';
      if (wasPlaying) queueMicrotask(() => this.dispatchEvent(new Event('pause')));
    };
    HTMLMediaElement.prototype.play = function() {
      return new Promise((resolve) => queueMicrotask(() => {
        this.dataset.fixturePaused = 'false';
        window.testMediaPlayingEvents = (window.testMediaPlayingEvents || 0) + 1;
        this.dispatchEvent(new Event('playing'));
        resolve();
      }));
    };
  }, { streaming });
  await page.goto('/?room=ROOM_A&s=fixture-secret');
  await expect(page).toHaveTitle('Watch Party | Watch together');
  await page.getByLabel('Your name').fill(host ? 'Host' : 'Guest');
  if (!host) await page.evaluate(() => window.seedTestDriveVideo());
  await page.getByRole('button', { name: host ? 'Create Room' : 'Join Room', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(host ? "Host's Room" : 'Friday movie');
  const roomId = await page.locator('.room-identity p > span').first().textContent();
  if (host) await page.evaluate((id) => window.seedTestDriveVideo(id), roomId);
  await page.evaluate(() => window.setTestConnection(true));
  if (!streaming) await page.getByRole('button', { name: 'Authorize', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(streaming ? 'Video preparation failed' : 'HTTP 503');
  return { errors, roomId };
}

test('Drive retry preserves playback, blocks duplicates and recovers from repeated preparation failure', async ({ page }, testInfo) => {
  const { errors, roomId } = await openDriveRoom(page);
  const before = await page.evaluate((id) => window.testPlaybackState(id), roomId);
  const retry = page.getByRole('button', { name: 'Retry video', exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(retry).toBeEnabled();
  expect(await page.evaluate(() => window.testPreparationRequests.length)).toBe(2);
  await page.screenshot({ path: testInfo.outputPath('drive-retry-error.png'), fullPage: true });
  await page.evaluate(() => { window.testPreparationMode = 'hold'; });
  await retry.evaluate((button) => { button.click(); button.click(); });
  await expect(page.getByRole('status', { name: 'Video preparation' })).toContainText(streaming ? 'Preparing stream' : 'Downloading video');
  await expect(page.getByLabel('Video URL')).toBeDisabled();
  expect(await page.evaluate(() => window.testPreparationRequests.length)).toBe(3);
  await page.evaluate(() => window.releaseTestPreparation());
  await expect(page.getByRole('status', { name: 'Video preparation' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Video URL')).toBeEnabled();
  await expect.poll(() => page.locator('video').first().getAttribute('data-fixture-src')).toMatch(streaming ? /fixture-movie\?t=fixture-ticket/ : /^blob:/);
  expect(await page.evaluate((id) => window.testPlaybackState(id), roomId)).toEqual(before);
  expect(await page.evaluate(() => window.testMediaUpdateCount || 0)).toBe(0);
  await expect(page.getByText('Video added to the room.')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('host retry stays local and is disabled while disconnected', async ({ page }) => {
  const { errors, roomId } = await openDriveRoom(page, true);
  const retry = page.getByRole('button', { name: 'Retry video', exact: true });
  const before = await page.evaluate((id) => window.testPlaybackState(id), roomId);
  await retry.click();
  await expect(retry).toBeEnabled();
  expect(await page.evaluate((id) => window.testPlaybackState(id), roomId)).toEqual(before);
  await page.evaluate(() => window.setTestConnection(false));
  await expect(retry).toBeDisabled();
  const requests = await page.evaluate(() => window.testPreparationRequests.length);
  await page.evaluate(() => { window.testPreparationMode = 'success'; });
  await page.evaluate(() => window.setTestConnection(true));
  if (!streaming) await retry.click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.testPreparationRequests.length)).toBe(requests + 1);
  expect(await page.evaluate(() => window.testMediaUpdateCount || 0)).toBe(0);
  expect(errors).toEqual([]);
});

test('changing source or leaving cancels a pending retry without stale UI or playback writes', async ({ page }) => {
  const { errors, roomId } = await openDriveRoom(page);
  await page.evaluate(() => { window.testPreparationMode = 'hold'; });
  await page.getByRole('button', { name: 'Retry video', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Video preparation' })).toBeVisible();
  await page.evaluate((id) => window.seedTestDriveVideo(id, 'abcdefghijk', 'youtube'), roomId);
  await expect.poll(() => page.evaluate(() => window.testPreparationRequests.at(-1).aborted)).toBe(true);
  await page.evaluate(() => window.releaseTestPreparation(false));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Media feedback' })).toHaveCount(0);
  await expect(page.getByLabel('Video URL')).toBeEnabled();
  await page.evaluate(() => { window.testPreparationMode = 'fail'; });
  await page.evaluate((id) => window.seedTestDriveVideo(id), roomId);
  await expect(page.getByRole('button', { name: 'Retry video', exact: true })).toBeEnabled();
  await page.evaluate(() => { window.testPreparationMode = 'hold'; });
  await page.getByRole('button', { name: 'Retry video', exact: true }).click();
  await page.getByRole('button', { name: 'Leave room', exact: true }).click();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.testPreparationRequests.at(-1).aborted)).toBe(true);
  await page.evaluate(() => window.releaseTestPreparation(false));
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.testMediaUpdateCount || 0)).toBe(0);
  expect(errors).toEqual([]);
});

test('successful host retry restores playback without replacing the shared reference clock', async ({ page }) => {
  const { errors, roomId } = await openDriveRoom(page, true);
  const before = await page.evaluate((id) => window.testPlaybackState(id), roomId);
  await page.evaluate(() => { window.testPreparationMode = 'success'; });
  await page.getByRole('button', { name: 'Retry video', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.testMediaPlayingEvents || 0)).toBeGreaterThan(0);
  expect(await page.evaluate((id) => window.testPlaybackState(id), roomId)).toEqual(before);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.locator('video').first().evaluate((video) => { video.currentTime = 60; video.dispatchEvent(new Event('ended')); });
  await expect.poll(() => page.evaluate((id) => window.testPlaybackState(id), roomId)).toMatchObject({ playbackState: 'PAUSED', anchorTime: 60 });
  expect(errors).toEqual([]);
});

test('native player errors show useful feedback and recoverable failures retry locally', async ({ page }, testInfo) => {
  const { errors, roomId } = await openDriveRoom(page);
  await page.evaluate(() => { window.testPreparationMode = 'success'; });
  await page.getByRole('button', { name: 'Retry video', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const before = await page.evaluate((id) => window.testPlaybackState(id), roomId);
  await page.locator('video').first().evaluate((video) => {
    Object.defineProperty(video, 'error', { configurable: true, value: { code: 4, message: 'private decoder detail' } });
    video.dispatchEvent(new Event('error'));
  });
  await expect(page.getByRole('alert')).toContainText('MP4');
  await expect(page.getByRole('button', { name: 'Retry playback' })).toHaveCount(0);
  await expect(page.getByText('private decoder detail')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('unsupported-playback.png'), fullPage: true });
  await page.locator('video').first().evaluate((video) => {
    Object.defineProperty(video, 'error', { configurable: true, value: { code: 2 } });
    video.dispatchEvent(new Event('error'));
  });
  await expect(page.getByRole('status', { name: 'Playback recovery' })).toContainText('Retrying');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate((id) => window.testPlaybackState(id), roomId)).toEqual(before);
  expect(errors).toEqual([]);
});

test('audio-only decoder fallback shows H.264 guidance instead of reporting video ready', async ({ page }) => {
  const { errors, roomId } = await openDriveRoom(page);
  const before = await page.evaluate(id => window.testPlaybackState(id), roomId);
  await page.evaluate(() => { window.testNoVideoTrack = true; window.testPreparationMode = 'success'; });
  await page.getByRole('button', { name: 'Retry video', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('H.264');
  await expect(page.getByRole('button', { name: 'Retry playback' })).toHaveCount(0);
  expect(await page.evaluate(id => window.testPlaybackState(id), roomId)).toEqual(before);
  expect(errors).toEqual([]);
});

test('short-lived stream access renews before expiry without changing the room clock', async ({ page }) => {
  test.skip(!streaming, 'Ticket renewal applies to streaming mode; download recovery runs separately.');
  const { errors, roomId } = await openDriveRoom(page, true);
  const before = await page.evaluate((id) => window.testPlaybackState(id), roomId);
  await page.evaluate(() => { window.testPreparationMode = 'success'; window.testTicketLifetimeMs = 31000; });
  await page.getByRole('button', { name: 'Retry video', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const count = await page.evaluate(() => window.testPreparationRequests.length);
  await page.evaluate(() => { window.testTicketLifetimeMs = 3600000; });
  await expect.poll(() => page.evaluate(() => window.testPreparationRequests.length)).toBe(count + 1);
  await expect(page.getByRole('status', { name: 'Playback recovery' })).toHaveCount(0);
  expect(await page.evaluate((id) => window.testPlaybackState(id), roomId)).toEqual(before);
  expect(errors).toEqual([]);
});

test('unavailable YouTube content shows an actionable error without retrying an embedding restriction', async ({ page }) => {
  const { errors, roomId } = await openDriveRoom(page);
  await page.evaluate((id) => {
    window.YT.Player = function(_container, options) {
      window.testYouTubeFailure = (code) => options.events.onError({ data: code });
      this.destroy = () => {};
    };
    window.seedTestDriveVideo(id, 'abcdefghijk', 'youtube');
  }, roomId);
  await expect.poll(() => page.evaluate(() => typeof window.testYouTubeFailure)).toBe('function');
  await page.evaluate(() => window.testYouTubeFailure(150));
  await expect(page.getByRole('alert')).toContainText('cannot be embedded');
  await expect(page.getByRole('button', { name: 'Retry playback' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('YouTube host recovery resumes locally without replacing the shared clock', async ({ page }) => {
  const { errors, roomId } = await openDriveRoom(page, true);
  await page.evaluate((id) => {
    window.testYouTubeMounts = 0;
    window.YT.Player = function(_container, options) {
      let state = 2, time = 0;
      window.testYouTubeMounts++;
      window.testYouTubeFailure = () => options.events.onError({ data: 5 });
      this.getPlayerState = () => state;
      this.getCurrentTime = () => time;
      this.getDuration = () => 600;
      this.seekTo = (value) => { time = value; };
      this.playVideo = () => { state = 1; queueMicrotask(() => options.events.onStateChange({ data: 1 })); };
      this.pauseVideo = () => { state = 2; queueMicrotask(() => options.events.onStateChange({ data: 2 })); };
      this.destroy = () => {};
      queueMicrotask(() => options.events.onReady());
    };
    window.seedTestDriveVideo(id, 'abcdefghijk', 'youtube');
  }, roomId);
  await expect.poll(() => page.evaluate(() => window.testYouTubeMounts)).toBe(1);
  // Allow initial synchronization, then compare every shared clock field across recovery.
  await page.waitForTimeout(600);
  const before = await page.evaluate((id) => window.testPlaybackState(id), roomId);
  await page.evaluate(() => window.testYouTubeFailure());
  await expect.poll(() => page.evaluate(() => window.testYouTubeMounts)).toBe(2);
  await page.waitForTimeout(600);
  expect(await page.evaluate((id) => window.testPlaybackState(id), roomId)).toEqual(before);
  expect(errors).toEqual([]);
});

test('YouTube autoplay permission guidance clears when the iframe starts playback', async ({ page }) => {
  const { errors, roomId } = await openDriveRoom(page);
  await page.evaluate(id => {
    window.YT.Player = function (_container, options) {
      let state = 2;
      this.getPlayerState = () => state; this.getCurrentTime = () => 0; this.getDuration = () => 600;
      this.seekTo = () => {}; this.playVideo = () => {}; this.pauseVideo = () => {}; this.destroy = () => {};
      window.testYouTubeBlocked = () => options.events.onAutoplayBlocked();
      window.testYouTubeStarted = () => { state = 1; options.events.onStateChange({ data: 1 }); };
      queueMicrotask(() => options.events.onReady());
    };
    window.seedTestDriveVideo(id, 'abcdefghijk', 'youtube');
  }, roomId);
  await expect.poll(() => page.evaluate(() => typeof window.testYouTubeBlocked)).toBe('function');
  await page.evaluate(() => window.testYouTubeBlocked());
  await expect(page.getByRole('status', { name: 'YouTube playback permission' })).toContainText('Tap Play inside the YouTube player');
  await expect(page.getByRole('button', { name: /Tap to Sync/ })).toHaveCount(0);
  await page.evaluate(() => window.testYouTubeStarted());
  await expect(page.getByRole('status', { name: 'YouTube playback permission' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
