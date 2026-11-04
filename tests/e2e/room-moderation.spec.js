import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
const dbFixture = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const authFixture = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
async function open(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5175') return route.continue();
    let body;
    if (url.pathname.endsWith('/firebase-database.js')) body = dbFixture;
    else if (url.pathname.endsWith('/firebase-auth.js')) body = authFixture;
    else if (url.pathname.endsWith('/firebase-app.js')) body = 'export const initializeApp = () => ({});';
    else if (url.hostname === 'www.youtube.com') body = 'window.YT={Player:function(){}};window.onYouTubeIframeAPIReady?.();';
    else if (url.hostname === 'accounts.google.com') body = 'window.google={accounts:{oauth2:{}}};';
    else throw Error('Unexpected external request');
    return route.fulfill({ body, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/?room=ROOM_A');
  await page.getByLabel('Your name', { exact: true }).fill('Guest');
  await page.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friday movie');
  await page.evaluate(() => window.setTestConnection(true));
  return errors;
}
test('room deletion promptly exits playback and explains lost access', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(async () => {
    const sdk = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js');
    await sdk.remove(sdk.ref(null, '/rooms/ROOM_A'));
  });
  await expect(page.getByRole('heading', { name: 'Join Room', exact: true })).toBeVisible();
  await expect(page.getByText('Your room access ended. Ask the host for access before joining again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join voice', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
