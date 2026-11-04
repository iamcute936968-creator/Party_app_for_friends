import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const databaseFixture = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const firebaseAuthFixture = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
const youtubeFixture = `
  window.testYouTubePlayers = [];
  window.YT = { Player: function(_container, options) {
    const record = { videoId: options.videoId, destroyed: false };
    window.testYouTubePlayers.push(record);
    this.getCurrentTime = () => 0;
    this.getPlayerState = () => 2;
    this.getDuration = () => 60;
    this.pauseVideo = () => {};
    this.seekTo = () => {};
    this.destroy = () => { record.destroyed = true; };
    const ready = () => { if (!record.destroyed) options.events.onReady(); };
    if (window.holdTestYouTubeReady) window.releaseTestYouTubeReady = ready;
    else queueMicrotask(ready);
  }};
  window.onYouTubeIframeAPIReady?.();
`;

async function enterRoom(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  page.on('dialog', async (dialog) => { errors.push('Unexpected blocking dialog'); await dialog.dismiss(); });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5175') return route.continue();
    let body;
    if (url.pathname.endsWith('/firebase-database.js')) body = databaseFixture;
    else if (url.pathname.endsWith('/firebase-auth.js')) body = firebaseAuthFixture;
    else if (url.pathname.endsWith('/firebase-app.js')) body = 'export const initializeApp = () => ({});';
    else if (url.hostname === 'www.youtube.com') body = youtubeFixture;
    else if (url.hostname === 'accounts.google.com') body = 'window.google = {accounts: {oauth2: {}}};';
    else throw new Error(`Unexpected external request to ${url.origin}`);
    return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
  await page.goto('/?room=ROOM_A');
  await expect(page).toHaveTitle('Watch Party | Watch together');
  await page.getByLabel('Your name').fill('Guest');
  await page.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friday movie');
  await page.evaluate(() => window.setTestConnection(true));
  return errors;
}

test('host transport waits for the selected YouTube player to become ready', async ({ page }) => {
  await enterRoom(page);
  await page.getByRole('button', { name: 'Leave room', exact: true }).click();
  await page.getByLabel('Your name').fill('Host');
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Host's Room");
  await page.evaluate(() => { window.holdTestYouTubeReady = true; });
  await page.getByLabel('Video URL', { exact: true }).fill('https://youtu.be/abcdefghijk');
  await page.getByRole('button', { name: 'Load video', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preparing player...', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => typeof window.releaseTestYouTubeReady)).toBe('function');
  await page.evaluate(() => window.releaseTestYouTubeReady());
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeEnabled();
  await play.click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
});

test('media validation, rejected write, pending duplicates and successful retry', async ({ page }, testInfo) => {
  const errors = await enterRoom(page);
  const input = page.getByLabel('Video URL');
  const form = page.getByRole('form', { name: 'Load a video' });
  const before = await page.evaluate(() => window.testPlaybackState('ROOM_A'));
  for (const invalid of ['', 'not-a-url', 'https://example.com/not-a-video', 'https://youtube.com/watch?v=short', 'https://drive.google.com/file/d/']) {
    await input.fill(invalid);
    await input.press('Enter');
    await expect(page.getByRole('alert')).toHaveText('Enter a valid YouTube, Google Drive, Watch Party anime, movie or TV watch link.');
  }
  expect(await page.evaluate(() => window.testMediaUpdateCount || 0)).toBe(0);
  await input.fill('https://youtu.be/abcdefghijk');
  await page.evaluate(() => window.rejectNextTestMedia());
  await input.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Could not add the video to the room. Try again.');
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(input).toHaveValue('https://youtu.be/abcdefghijk');
  expect(await page.evaluate(() => window.testPlaybackState('ROOM_A'))).toEqual(before);
  await expect(page.getByText('private media update detail')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('media-load-error.png'), fullPage: true });
  await page.evaluate(() => window.pauseNextTestMedia());
  await form.evaluate((element) => { element.requestSubmit(); element.requestSubmit(); });
  await expect(page.getByRole('button', { name: 'Loading...', exact: true })).toBeDisabled();
  await expect(input).toBeDisabled();
  if (await page.evaluate(() => typeof navigator.mediaDevices?.getDisplayMedia === 'function')) {
    await expect(page.getByRole('button', { name: 'Share screen', exact: true })).toBeDisabled();
  } else {
    await expect(page.getByRole('status', { name: 'Screen sharing availability' })).toContainText('desktop');
  }
  expect(await page.evaluate(() => window.testMediaUpdateCount)).toBe(2);
  await expect(page.getByText('Video added to the room.')).toHaveCount(0);
  await page.evaluate(() => window.releaseTestMedia());
  await expect(page.getByRole('status', { name: 'Media feedback' })).toHaveText('Video added to the room.');
  await expect(input).toBeEnabled();
  expect((await page.evaluate(() => window.testPlaybackState('ROOM_A'))).videoId).toBe('abcdefghijk');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('log', { name: 'Recent messages' }).getByText('Guest loaded YouTube video', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('log', { name: 'Recent messages' }).getByText('Guest joined', { exact: true })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('media-load-success.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a failed replacement preserves the current adapter and a same-video retry remounts it', async ({ page }) => {
  const errors = await enterRoom(page);
  const input = page.getByLabel('Video URL');
  await input.fill('https://youtu.be/abcdefghijk');
  await input.press('Enter');
  await expect(page.getByRole('status', { name: 'Media feedback' })).toHaveText('Video added to the room.');
  await expect.poll(() => page.evaluate(() => window.testYouTubePlayers.filter((player) => !player.destroyed).length)).toBe(1);
  const before = await page.evaluate(() => window.testPlaybackState('ROOM_A'));
  await input.fill('https://youtu.be/lmnopqrstuv');
  await page.evaluate(() => window.rejectNextTestMedia());
  await input.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Could not add the video to the room. Try again.');
  expect(await page.evaluate(() => window.testPlaybackState('ROOM_A'))).toEqual(before);
  expect(await page.evaluate(() => window.testYouTubePlayers.filter((player) => !player.destroyed).map((player) => player.videoId))).toEqual(['abcdefghijk']);
  await input.fill('https://youtu.be/abcdefghijk');
  await input.press('Enter');
  await expect(page.getByRole('status', { name: 'Media feedback' })).toHaveText('Video added to the room.');
  await expect.poll(() => page.evaluate(() => window.testYouTubePlayers.length)).toBe(2);
  expect(await page.evaluate(() => window.testYouTubePlayers.filter((player) => !player.destroyed).length)).toBe(1);
  expect(errors).toEqual([]);
});

test('leaving during a submitted media write keeps its completion out of the next room', async ({ page }) => {
  const errors = await enterRoom(page);
  await page.getByLabel('Video URL').fill('https://youtu.be/abcdefghijk');
  await page.evaluate(() => window.pauseNextTestMedia());
  await page.getByRole('button', { name: 'Load video', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Loading...', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Leave room', exact: true }).click();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await page.evaluate(() => window.seedTestAlternateRoom());
  await page.getByLabel('Room code or invite link').fill('https://invite.example/?room=ROOM_B&s=fixture-secret-b');
  await page.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Another movie');
  await page.evaluate(() => window.releaseTestMedia());
  await expect(page.getByRole('status', { name: 'Media feedback' })).toHaveCount(0);
  await expect(page.getByLabel('Video URL')).toHaveValue('');
  await expect(page.getByText('Your screen is ready.')).toBeVisible();
  expect((await page.evaluate(() => window.testPlaybackState('ROOM_B'))).videoId).toBeNull();
  expect(errors).toEqual([]);
});
