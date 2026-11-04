import { expect, test } from '@playwright/test';
test('host bans stop native media, prevent the same identity rejoining, and unban restores enrollment', async ({ browser }) => {
  test.setTimeout(90000);
  const contexts = [], errors = [];
  async function client() {
    const context = await browser.newContext({ permissions: ['microphone'] }); contexts.push(context);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url()); let body;
      if (url.origin === 'http://127.0.0.1:5175' && url.pathname === '/src/firebaseClient.js') body = "export {database,ensureFirebaseUser,firebaseAuth,accountSdk} from '/tests/rtc/firebase-emulator-client.js';";
      else if (['http://127.0.0.1:5175', 'http://127.0.0.1:9000', 'http://127.0.0.1:9099'].includes(url.origin)) return route.continue();
      else if (url.pathname.endsWith('/firebase-database.js')) body = "export * from 'http://127.0.0.1:5175/tests/rtc/firebase-emulator-client.js';";
      else if (url.hostname === 'www.youtube.com') body = 'window.YT={Player:function(){}};window.onYouTubeIframeAPIReady?.();';
      else if (url.hostname === 'accounts.google.com') body = 'window.google={accounts:{oauth2:{}}};';
      else throw Error('Unexpected external moderation test request');
      return route.fulfill({ contentType: 'text/javascript', body, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.addInitScript(() => {
      window.qaPeers = []; window.qaMics = [];
      const Native = RTCPeerConnection;
      window.RTCPeerConnection = function (config) { const peer = new Native({ ...config, iceServers: [] }); window.qaPeers.push(peer); return peer; };
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async options => { const stream = await capture(options); window.qaMics.push(stream); return stream; };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.qaInvite = value; } } });
    });
    return page;
  }
  try {
    const host = await client(); await host.goto('/'); await host.getByLabel('Your name').fill('Host');
    await host.getByRole('button', { name: 'Create Room', exact: true }).click();
    await expect(host.getByRole('heading', { level: 1 })).toHaveText("Host's Room");
    await host.getByRole('button', { name: 'Copy invite', exact: true }).click();
    const guest = await client(); await guest.goto(await host.evaluate(() => window.qaInvite));
    await guest.getByLabel('Your name').fill('Guest'); await guest.getByRole('button', { name: 'Join Room', exact: true }).click();
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText("Host's Room");
    await host.getByRole('button', { name: 'Join voice', exact: true }).click();
    await guest.getByRole('button', { name: 'Join voice', exact: true }).click();
    await expect.poll(() => guest.evaluate(() => window.qaPeers.some(peer => peer.connectionState === 'connected'))).toBe(true);
    await host.getByRole('button', { name: 'People (2)', exact: true }).click();
    await host.getByRole('button', { name: 'Ban Guest', exact: true }).click();
    await host.getByRole('button', { name: 'Confirm ban', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Join Room', exact: true })).toBeVisible();
    await expect.poll(() => guest.evaluate(() => window.qaMics.flatMap(stream => stream.getTracks()).every(track => track.readyState === 'ended'))).toBe(true);
    await expect.poll(() => host.evaluate(() => window.qaPeers.every(peer => peer.connectionState === 'closed'))).toBe(true);
    await guest.getByRole('button', { name: 'Join Room', exact: true }).click();
    await expect(guest.locator('.entry-error')).toBeVisible();
    await expect(guest.getByRole('heading', { name: 'Join Room', exact: true })).toBeVisible();
    await host.getByText('Banned members (1)', { exact: true }).click();
    await host.getByRole('button', { name: 'Unban Guest', exact: true }).click();
    await expect(host.getByText('Banned members (0)', { exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Join Room', exact: true }).click();
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText("Host's Room");
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
