import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
const database = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
async function openRoom(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5175') return route.continue();
    let body;
    if (url.pathname.endsWith('/firebase-database.js')) body = database;
    else if (url.pathname.endsWith('/firebase-auth.js')) body = auth;
    else if (url.pathname.endsWith('/firebase-app.js')) body = 'export const initializeApp=()=>({});';
    else if (url.hostname === 'www.youtube.com') body = 'window.YT={Player:function(){}};window.onYouTubeIframeAPIReady?.();';
    else if (url.hostname === 'accounts.google.com') body = 'window.google={accounts:{oauth2:{}}};';
    else throw new Error('Unexpected provider in isolated chat test');
    return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
  await page.goto('/?room=ROOM_A');
  await page.evaluate(() => window.seedTestMessages('ROOM_A'));
  await page.getByLabel('Your name').fill('Guest');
  await page.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friday movie');
  await page.evaluate(() => window.setTestConnection(true));
  return errors;
}
test('fullscreen receives new messages and sends/retries without leaving the viewing stage', async ({ page }, info) => {
  const errors = await openRoom(page);
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  const stage = page.locator('.video-stage[data-fullscreen="true"]');
  await expect(stage).toBeVisible();
  const notices = stage.getByRole('log', { name: 'On-screen messages' });
  await expect(notices).toHaveText('');
  await page.evaluate(async () => {
    const sdk = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js');
    await sdk.push(sdk.ref(null, '/rooms/ROOM_A/messages'), { type: 'user', user: 'Peer', text: 'Watch this scene', timestamp: Date.now() });
  });
  await expect(notices).toContainText('Watch this scene');
  await expect(stage.getByRole('button', { name: /Open on-screen chat, 1 unread/ })).toBeVisible();
  await stage.getByRole('button', { name: /Open on-screen chat/ }).click();
  const input = stage.getByLabel('Message in video');
  await input.fill('Still in fullscreen');
  await page.evaluate(() => window.rejectNextTestMessage());
  await input.press('Enter');
  await expect(stage.getByLabel('On-screen message feedback')).toContainText('not sent');
  await expect(input).toHaveValue('Still in fullscreen');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(stage.getByRole('log', { name: 'On-screen conversation' })).toContainText('Still in fullscreen');
  await expect(page.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('fullscreen-chat.png') });
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect(page.locator('.video-stage')).toHaveAttribute('data-fullscreen', 'false');
  expect(errors).toEqual([]);
});
test('an Android-style browser offers viewing guidance without an unsupported Share action', async ({ page }) => {
  await page.addInitScript(() => { if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined, configurable: true }); });
  const errors = await openRoom(page);
  await expect(page.getByRole('button', { name: 'Share screen', exact: true })).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Screen sharing availability' })).toContainText('desktop');
  expect(errors).toEqual([]);
});
