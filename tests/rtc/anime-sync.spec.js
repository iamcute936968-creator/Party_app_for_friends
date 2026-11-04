import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import process from 'node:process';
import { fulfillAnimeFixture } from '../helpers/anime-hls-fixture';
const live = process.env.WATCH_PARTY_LIVE_ANIME === '1';
let liveApi, liveBase;
const liveRequests = [];
test.beforeAll(async () => {
  if (!live) return;
  const { createApp } = createRequire(import.meta.url)('../../../media-proxy/server.cjs');
  liveApi = createApp({ turnClient: { configured: false } });
  await new Promise(resolve => liveApi.server.listen(0, '127.0.0.1', resolve));
  liveBase = `http://127.0.0.1:${liveApi.server.address().port}`;
});
test.afterAll(async () => { if (liveApi) { await new Promise(resolve => liveApi.server.close(resolve)); console.log(JSON.stringify({ liveApiResponses: liveRequests })); } });

test('two native HLS clients follow the host clock, late join, seek, episode changes and reconnect', async ({ browser }, info) => {
  test.setTimeout(live ? 180000 : 90000);
  const contexts = [], errors = [], streamRequests = new Map();
  const makePage = async name => {
    const context = await browser.newContext({ viewport: { width: name === 'member' ? 390 : 1440, height: 900 } }); contexts.push(context);
    const page = await context.newPage(); streamRequests.set(name, 0); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('/api/paradise') && url.pathname.endsWith('/stream')) streamRequests.set(name, streamRequests.get(name) + 1);
      if (live && url.pathname.includes('/api/paradise')) {
        const response = await fetch(liveBase + url.pathname.slice(url.pathname.indexOf('/api/paradise')) + url.search);
        liveRequests.push({ participant: name, path: url.pathname.slice(url.pathname.indexOf('/api/paradise')), status: response.status });
        return route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
      }
      if (!live && await fulfillAnimeFixture(route)) return;
      if (url.origin === 'http://127.0.0.1:5175' && url.pathname === '/src/firebaseClient.js') return route.fulfill({ contentType: 'text/javascript', body: "export {database,ensureFirebaseUser,firebaseAuth,accountSdk} from '/tests/rtc/firebase-emulator-client.js';" });
      if (['http://127.0.0.1:5175', 'http://127.0.0.1:9000', 'http://127.0.0.1:9099'].includes(url.origin)) return route.continue();
      if (live && !['www.gstatic.com', 'www.youtube.com', 'accounts.google.com'].includes(url.hostname)) return route.continue();
      const body = url.pathname.endsWith('/firebase-database.js') ? "export * from 'http://127.0.0.1:5175/tests/rtc/firebase-emulator-client.js';"
        : url.hostname === 'www.youtube.com' ? 'window.YT={};window.onYouTubeIframeAPIReady?.();' : url.hostname === 'accounts.google.com' ? 'window.google={accounts:{oauth2:{}}};' : '';
      return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
    });
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.testInvite = value; } }, configurable: true }));
    return page;
  };
  const position = page => page.getByLabel('Room video', { exact: true }).evaluate(el => el.currentTime);
  const state = (page, id) => page.evaluate(async id => {
    const sdk = await import('/tests/rtc/firebase-emulator-client.js');
    const room = (await sdk.get(sdk.ref(sdk.database, `rooms/${id}`))).val();
    return { playbackState: room.playbackState, anchorTime: room.anchorTime, episode: room.animeEpisode, selection: room.mediaSelectionId,
      privateUrlStored: JSON.stringify(room).includes('room-fixture') || JSON.stringify(room).includes('stream.animeparadise.moe'), source: room.videoSource };
  }, id);
  try {
    const host = await makePage('host'); await host.goto('/anime/ap_naruto'); await host.getByRole('button', { name: 'Watch together', exact: true }).click();
    await host.getByLabel('Your name', { exact: true }).fill('Host'); await host.getByRole('button', { name: 'Create Room', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: live ? 35000 : 5000 });
    const id = await host.locator('.room-identity p > span').first().textContent();
    await host.getByRole('button', { name: 'Copy invite', exact: true }).click(); const invite = await host.evaluate(() => window.testInvite);
    await host.getByRole('button', { name: 'Play', exact: true }).click(); await expect.poll(() => position(host)).toBeGreaterThan(1);
    const member = await makePage('member'); await member.goto(invite); await member.getByLabel('Your name', { exact: true }).fill('Member'); await member.getByRole('button', { name: 'Join Room', exact: true }).click();
    const memberVideo = member.getByLabel('Room video', { exact: true });
    await expect.poll(() => memberVideo.evaluate(el => el.videoWidth), { timeout: live ? 35000 : 5000 }).toBeGreaterThan(0);
    const tap = member.getByRole('button', { name: /Tap to Sync/ });
    await expect.poll(async () => { if (await tap.isVisible()) await tap.click(); return memberVideo.evaluate(el => !el.paused && el.currentTime > .2); }, { timeout: live ? 40000 : 10000 }).toBe(true);
    await expect.poll(async () => Math.abs(await position(host) - await position(member))).toBeLessThan(2);
    await expect(member.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
    await host.getByRole('button', { name: 'Pause', exact: true }).click(); await expect.poll(() => memberVideo.evaluate(el => el.paused)).toBe(true);
    const slider = host.getByRole('slider', { name: 'Video timeline' }), bounds = await slider.boundingBox();
    await slider.click({ position: { x: bounds.width * .6, y: bounds.height / 2 } });
    await expect.poll(() => position(member)).toBeGreaterThan(10);
    expect((await state(host, id)).privateUrlStored).toBe(false);
    const before = await state(host, id);
    await host.getByRole('button', { name: 'Watch episode 2', exact: true }).click();
    await expect(member.getByRole('button', { name: 'Watch episode 2', exact: true })).toHaveAttribute('aria-current', 'true', { timeout: live ? 35000 : 5000 });
    await expect.poll(() => position(member)).toBeLessThan(1);
    await expect.poll(async () => (await state(host, id)).selection).not.toBe(before.selection);
    await host.getByRole('button', { name: 'Play', exact: true }).click(); await expect.poll(() => position(member)).toBeGreaterThan(.3);
    const beforeReconnect = streamRequests.get('member');
    await member.evaluate(async () => { const sdk = await import('/tests/rtc/firebase-emulator-client.js'); sdk.goOffline(sdk.database); });
    await member.evaluate(async () => { const sdk = await import('/tests/rtc/firebase-emulator-client.js'); sdk.goOnline(sdk.database); });
    await expect.poll(() => streamRequests.get('member')).toBeGreaterThan(beforeReconnect);
    await expect(member.getByRole('status', { name: 'Anime preparation' })).toHaveCount(0, { timeout: live ? 35000 : 10000 });
    await expect.poll(async () => { if (await tap.isVisible()) await tap.click(); return memberVideo.evaluate(el => el.readyState >= 2 && el.videoWidth > 0 && !el.paused); }, { timeout: live ? 35000 : 10000 }).toBe(true);
    await expect.poll(async () => Math.abs(await position(host) - await position(member))).toBeLessThan(2);
    expect(streamRequests.get('host')).toBeGreaterThanOrEqual(2); expect(streamRequests.get('member')).toBeGreaterThanOrEqual(2);
    console.log(JSON.stringify({ animeSyncEvidence: live ? 'live-provider-local-emulators' : 'local-hls-local-emulators',
      driftSeconds: Math.abs(await position(host) - await position(member)), hostResolutions: streamRequests.get('host'), memberResolutions: streamRequests.get('member'),
      lateJoin: true, hostPauseAndSeek: true, episodeSwitch: true, reconnect: true, privateUrlStored: (await state(host, id)).privateUrlStored }));
    await host.getByLabel('Room video', { exact: true }).scrollIntoViewIfNeeded(); await memberVideo.scrollIntoViewIfNeeded();
    await host.screenshot({ path: info.outputPath(`anime-sync-${live ? 'live' : 'fixture'}-host.png`), fullPage: false }); await member.screenshot({ path: info.outputPath(`anime-sync-${live ? 'live' : 'fixture'}-member.png`), fullPage: false });
    await member.getByRole('button', { name: 'Leave room', exact: true }).click(); await expect(memberVideo).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
