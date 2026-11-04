import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const database = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
const camp = { id: '98444', title: 'Laid-Back Camp', description: 'Friends explore the outdoors on a camping trip.',
  genres: ['Comedy', 'Slice of Life'], score: 80, year: 2018, totalEpisodes: 12, duration: 24, format: 'TV', status: 'FINISHED',
  studio: 'C-Station', cover: '', banner: '', trailerId: 'vpH42sJ8t9c', links: [], source: 'live', notice: '',
  episodes: [1, 2].map((number, index) => ({ number, id: ['2C7Kp0yBpvo', 'n6yhyJWK6Gc'][index],
    provider: 'Ani-One Asia', language: 'Traditional Chinese subtitles', embeddable: true })) };
const hyouka = { ...camp, id: '12189', title: 'Hyouka', trailerId: '', episodes: [{ number: 1, id: 'Ii7im-MQQ0A',
  provider: 'Muse India', language: 'English subtitles', embeddable: false }] };
const youtube = `window.qaPlayers=[]; window.YT={Player:function(id,options){
  const node=document.getElementById(id); node.textContent='Test video surface';
  const player={time:0,state:5,destroyed:false,videoId:options.videoId,
    getCurrentTime(){return this.time},getDuration(){return 1420},getPlayerState(){return this.state},
    seekTo(time){this.time=time},playVideo(){this.state=1;options.events.onStateChange({data:1})},
    pauseVideo(){this.state=2;options.events.onStateChange({data:2})},destroy(){this.destroyed=true;node.remove()}};
  window.qaPlayers.push(player);setTimeout(()=>options.events.onReady(),0);return player;
}};window.onYouTubeIframeAPIReady?.();`;

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/__test/media-proxy/api/paradise')) return route.fulfill({ json: { items: [], pageInfo: { page: 1, hasNextPage: false } } });
    if (url.pathname.startsWith('/__test/media-proxy/api/anime')) {
      const id = url.pathname.split('/api/anime/')[1];
      if (id && !['98444', '12189'].includes(id)) return route.fulfill({ status: 404, json: { error: 'Not found' } });
      return route.fulfill({ json: id ? id === '98444' ? camp : hyouka
        : { items: url.searchParams.get('search') ? [camp] : [camp, hyouka], source: 'live',
          pageInfo: { page: Number(url.searchParams.get('page') || 1), hasNextPage: false } } });
    }
    if (url.origin === 'http://127.0.0.1:5175') return route.continue();
    let body;
    if (url.pathname.endsWith('/firebase-database.js')) body = database;
    else if (url.pathname.endsWith('/firebase-auth.js')) body = auth;
    else if (url.pathname.endsWith('/firebase-app.js')) body = 'export const initializeApp=()=>({});';
    else if (url.hostname === 'www.youtube.com') body = youtube;
    else if (url.hostname === 'accounts.google.com') body = 'window.google={accounts:{oauth2:{}}};';
    else throw new Error(`Unexpected anime test request: ${url.origin}`);
    return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
});

test('browses official titles, saves one across reload and opens it from Library', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/anime');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Anime', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Explore anime', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Official episodes', exact: true }).click();
  await page.getByRole('button', { name: 'Details for Laid-Back Camp' }).click();
  await expect(page).toHaveURL(/\/anime\/98444$/);
  await expect(page.getByRole('heading', { name: 'Laid-Back Camp', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Episode sources' })).toContainText('2 listed here');
  await page.getByRole('button', { name: 'Save anime', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove saved anime', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove saved anime', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Wishlist', exact: true }).click();
  await page.getByRole('button', { name: 'Open Laid-Back Camp', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Laid-Back Camp');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('anime-details.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('plays solo, saves progress, changes episode and stops the player when leaving', async ({ page }) => {
  await page.goto('/anime/98444/watch/1');
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await page.evaluate(() => { window.qaPlayers.at(-1).time = 45; });
  await page.getByRole('button', { name: 'Next episode', exact: true }).click();
  await expect(page).toHaveURL(/\/anime\/98444\/watch\/2$/);
  await expect.poll(() => page.evaluate(() => window.qaPlayers[0]?.destroyed)).toBe(true);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('watchparty.viewing-library.v1'))[0]?.position)).toBe(45);
  await page.getByRole('button', { name: 'Previous episode', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.qaPlayers.at(-1)?.time)).toBe(45);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.qaPlayers.every(player => player.destroyed))).toBe(true);
  await expect(page.getByText('Laid-Back Camp · Episode 1', { exact: true })).toBeVisible();
});

test('keeps blocked episodes external and handles missing or malformed titles', async ({ page }) => {
  await page.goto('/anime/12189');
  await expect(page.getByRole('link', { name: /Watch on YouTube/ })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=Ii7im-MQQ0A');
  await expect(page.getByRole('button', { name: 'Watch episode 1', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.qaPlayers.length)).toBe(0);
  await page.goto('/anime/999999');
  await expect(page.getByRole('alert')).toContainText('not available');
  await page.goto('/anime/not-an-id');
  await expect(page.getByRole('alert')).toContainText('address is not available');
  expect(await page.evaluate(() => window.qaPlayers.length)).toBe(0);
});

test('changes official collection filters and supports narrow screens without overflow', async ({ page }, info) => {
  if (info.project.name.includes('mobile')) await page.setViewportSize({ width: 320, height: 740 });
  const queries = [];
  page.on('request', request => { if (request.url().includes('/api/anime?')) queries.push(new URL(request.url()).searchParams); });
  await page.goto('/anime');
  await page.getByRole('button', { name: 'Official episodes', exact: true }).click();
  await page.getByRole('button', { name: 'Details for Hyouka' }).waitFor();
  await page.getByRole('combobox', { name: 'Genre', exact: true }).selectOption('Comedy');
  await expect.poll(() => queries.at(-1)?.get('genre')).toBe('Comedy');
  await page.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('score');
  await expect.poll(() => queries.at(-1)?.get('sort')).toBe('score');
  await expect(page.getByRole('button', { name: 'Details for Laid-Back Camp' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const links = await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link').all();
  for (const link of links) expect((await link.boundingBox()).width).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath('anime-browse.png'), fullPage: true });
});

test('closes trailer with Escape and destroys playback before returning focus', async ({ page }) => {
  await page.goto('/anime/98444');
  const trigger = page.getByRole('button', { name: 'Watch trailer', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Laid-Back Camp trailer', exact: true });
  await dialog.getByRole('button', { name: 'Play video', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => window.qaPlayers.at(-1).destroyed)).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('watchparty.viewing-library.v1')))).toEqual([]);
});
