import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
const database = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
const seasonId = 'ap_kidou-senshi-gundam-suisei-no-majo-part-2';
const title = id => ({ id, title: id === 'ap_sonic-x' ? 'Sonic X' : 'Mobile Suit Gundam: The Witch from Mercury Season 2',
  genres: [], links: [], cover: '', banner: '', description: '', totalEpisodes: id === 'ap_sonic-x' ? 52 : 12,
  episodes: Array.from({ length: id === 'ap_sonic-x' ? 52 : 12 }, (_, index) => ({ number: index + 1,
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`, source: 'hls', embeddable: true, provider: 'AnimeParadise', language: 'Subtitled' })) });
const youtube = `window.qaPlayers=[];window.YT={Player:function(id,options){const node=document.getElementById(id);node.textContent='Controlled YouTube surface';
 const player={videoId:options.videoId,time:0,state:5,destroyed:false,getCurrentTime(){return this.time},getDuration(){return 1400},getPlayerState(){return this.state},
 seekTo(time){this.time=time},playVideo(){this.state=1;options.events.onStateChange({data:1})},pauseVideo(){this.state=2;options.events.onStateChange({data:2})},destroy(){this.destroyed=true;node.remove()}};
 window.qaPlayers.push(player);setTimeout(()=>options.events.onReady(),0);return player;}};window.onYouTubeIframeAPIReady?.();`;
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.pathname.includes('/api/paradise')) {
      if (u.pathname.endsWith('/stream')) return route.fulfill({ status: 503, json: { error: 'Controlled unavailable Sub stream' } });
      const id = u.pathname.split('/api/paradise/')[1];
      return route.fulfill({ json: id ? title(id) : { items: [title('ap_sonic-x')], pageInfo: { page: 1, hasNextPage: false } } });
    }
    if (u.origin === 'http://127.0.0.1:5175') return route.continue();
    const body = u.pathname.endsWith('/firebase-database.js') ? database : u.pathname.endsWith('/firebase-auth.js') ? auth
      : u.pathname.endsWith('/firebase-app.js') ? 'export const initializeApp=()=>({});' : u.hostname === 'www.youtube.com' ? youtube
        : u.hostname === 'accounts.google.com' ? 'window.google={accounts:{oauth2:{}}};' : '';
    await route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
});
test('selects the last verified Sonic Dub episode, credits TMS and keeps later episodes explicitly unavailable', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/anime/ap_sonic-x/watch/26');
  await page.getByRole('button', { name: 'Dub', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.qaPlayers.at(-1)?.videoId)).toBe('Lj6TQAJaj4s');
  await expect(page.getByText(/26 verified official YouTube episodes/)).toBeVisible();
  await expect(page.getByText('English audio · Anime! on TMS Official Channel', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Watch episode 27', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sub', exact: true }).click();
  expect(await page.evaluate(() => window.qaPlayers[0].destroyed)).toBe(true);
  await page.getByRole('button', { name: 'Watch episode 52', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dub', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('sonic-dub-availability.png') });
  expect(errors).toEqual([]);
});
test('uses season-local episode numbers for Mercury season two without inventing its final Dub', async ({ page }) => {
  await page.goto(`/anime/${seasonId}/watch/1`); await page.getByRole('button', { name: 'Dub', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.qaPlayers.at(-1)?.videoId)).toBe('b9UVaK2hfkk');
  await page.getByRole('button', { name: 'Watch episode 11', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.qaPlayers.at(-1)?.videoId)).toBe('7rIQQmrpZe4');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Episode 11');
  await page.getByRole('button', { name: 'Sub', exact: true }).click();
  await page.getByRole('button', { name: 'Watch episode 12', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dub', exact: true })).toBeDisabled();
});
test('chooses Sonic Dub inside a room and changes the shared Sub/Dub source at time zero', async ({ page }) => {
  await page.goto('/'); await page.getByLabel('Your name', { exact: true }).fill('Host');
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await page.evaluate(() => window.setTestConnection(true));
  const stage = await page.locator('.video-stage').elementHandle();
  await page.getByRole('button', { name: 'Browse media', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Browse media for this room' });
  await dialog.getByRole('button', { name: 'Details for Sonic X', exact: true }).click();
  await dialog.getByRole('button', { name: 'Dub', exact: true }).click();
  await dialog.getByRole('button', { name: 'Watch episode 26', exact: true }).click(); await expect(dialog).toHaveCount(0);
  const id = await page.locator('.room-identity p > span').first().textContent();
  await expect.poll(() => page.evaluate(id => window.testPlaybackState(id).videoId, id)).toBe('Lj6TQAJaj4s');
  await page.getByRole('button', { name: 'Sub', exact: true }).click();
  await expect.poll(() => page.evaluate(id => window.testRoomAnime(id).episode, id)).toBe(26);
  await page.getByRole('button', { name: 'Dub', exact: true }).click();
  await expect.poll(() => page.evaluate(id => window.testPlaybackState(id).videoId, id)).toBe('Lj6TQAJaj4s');
  expect((await page.evaluate(id => window.testPlaybackState(id), id)).anchorTime).toBe(0);
  expect(await stage.evaluate(node => node.isConnected)).toBe(true);
});
