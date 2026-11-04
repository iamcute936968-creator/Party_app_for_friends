import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
const databaseFixture = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const authFixture = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
const youtube = `window.YT = { Player: function(_id, options) {
  const player = { time: 0, state: 5, getCurrentTime(){return this.time}, getDuration(){return 100},
    getPlayerState(){return this.state}, seekTo(time){this.time=time},
    playVideo(){this.state=1;options.events.onStateChange({data:1})},
    pauseVideo(){this.state=2;options.events.onStateChange({data:2})}, destroy(){} };
  window.qaPlayer=player; setTimeout(()=>{options.events.onReady();if(window.qaInitialPause)setTimeout(()=>{player.state=2;options.events.onStateChange({data:2})},10)},0); return player;
} }; window.onYouTubeIframeAPIReady?.();`;
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5175') return route.continue();
    let body;
    if (url.pathname.endsWith('/firebase-database.js')) body = databaseFixture;
    else if (url.pathname.endsWith('/firebase-auth.js')) body = authFixture;
    else if (url.pathname.endsWith('/firebase-app.js')) body = 'export const initializeApp=()=>({});';
    else if (url.hostname === 'www.youtube.com') body = youtube;
    else if (url.hostname === 'accounts.google.com') body = 'window.google={accounts:{oauth2:{}}};';
    else throw new Error('Unexpected external test request');
    await route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
});
async function value(page, path) {
  return page.evaluate(async path => {
    const sdk = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js');
    return (await sdk.get(sdk.ref(null, path))).val();
  }, path);
}
async function create(page) {
  await page.getByLabel('Your name', { exact: true }).fill('Host');
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Host's Room");
  await page.evaluate(() => window.setTestConnection(true));
  await expect(page.getByRole('status', { name: 'Live room connection' })).toContainText('Connected');
  return page.locator('.room-identity p > span').first().textContent();
}
for (const initialPause of [false, true]) test(`saved viewing position survives provider startup pause=${initialPause}, resumes and returns home`, async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(value => { window.qaInitialPause = value; }, initialPause);
  await page.addInitScript(() => localStorage.setItem('watchparty.viewing-library.v1', JSON.stringify([
    { source: 'youtube', id: 'abcdefghijk', title: 'Friday movie', position: 40, duration: 100,
      wishlist: true, updatedAt: Date.now(), lastWatchedAt: Date.now() },
  ])));
  await page.goto('/');
  await expect(page).toHaveTitle('Watch Party | Watch together');
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Choose Friday movie' }).click();
  await expect(page.getByText(/Next room: Friday movie/)).toBeVisible();
  const id = await create(page);
  await expect.poll(() => page.evaluate(() => window.qaPlayer?.time)).toBe(40);
  expect((await value(page, `/rooms/${id}`)).playbackState).toBe('PAUSED');
  await page.evaluate(() => { window.qaPlayer.time = 10; });
  await page.getByRole('button', { name: 'Browse media', exact: true }).click();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Resume at 0:40' }).click();
  await expect.poll(async () => (await value(page, `/rooms/${id}`)).anchorTime).toBe(40);
  await expect.poll(() => page.evaluate(() => window.qaPlayer.time)).toBe(40);
  await page.getByRole('button', { name: 'Close browser', exact: true }).click();
  await page.getByRole('button', { name: 'Leave room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make it a movie night.' })).toBeVisible();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByText('Friday movie', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('viewing-library.png'), fullPage: true });
  expect(errors).toEqual([]);
});
test('avatar preference and draft-free typing work with fullscreen conversation', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByLabel('Your avatar colour').selectOption('coral');
  await page.getByRole('link', { name: 'Watch Together', exact: true }).click();
  const id = await create(page);
  await expect.poll(async () => (await value(page, `/rooms/${id}/profiles/Host`))?.avatar).toBe('coral');
  await expect(page.getByLabel('Your avatar colour')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Message', { exact: true }).fill('private draft');
  await expect.poll(async () => Object.keys(await value(page, `/rooms/${id}/typing/Host`) || {}).length).toBe(1);
  expect(JSON.stringify(await value(page, `/rooms/${id}/typing/Host`))).not.toContain('private draft');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(async () => Object.keys(await value(page, `/rooms/${id}/typing/Host`) || {}).length).toBe(0);
  await page.evaluate(async id => {
    const sdk = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js');
    await sdk.update(sdk.ref(null, `/rooms/${id}`), {
      'participants/Guest/connections/g': true, 'profiles/Guest': { avatar: 'sand' },
      'typing/Guest/g': { updatedAt: Date.now() },
    });
  }, id);
  await expect(page.getByText('Guest is typing…')).toBeVisible();
  await page.getByRole('tab', { name: 'Watch', exact: true }).click();
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await page.getByRole('button', { name: /^Open on-screen chat/ }).click();
  await expect(page.getByRole('region', { name: 'On-screen chat' }).getByText('Guest is typing…')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('participants-fullscreen.png') });
  await expect(page.getByText('Guest is typing…')).toHaveCount(0, { timeout: 10000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('watchparty.participant-profile.v1')).avatar)).toBe('coral');
  expect(errors).toEqual([]);
});
