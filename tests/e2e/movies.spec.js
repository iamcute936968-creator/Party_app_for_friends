import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
const database = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8'), auth = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
const movie = { id: '10378', mediaKind: 'movie', title: 'Big Buck Bunny', year: 2008, description: 'An open animated film for a shared evening.', cover: 'https://image.tmdb.org/t/p/w500/fixture.jpg', banner: '', score: 7.2, runtime: 10, genres: ['Animation'], seasons: [], externalIds: { imdb: 'tt1254207' } };
const tv = { ...movie, id: '1399', mediaKind: 'tv', title: 'The test series', seasons: [{ number: 1, name: 'Season 1', episodeCount: 2 }, { number: 2, name: 'Season 2', episodeCount: 2 }], externalIds: {} };
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#243d43"/><circle cx="150" cy="170" r="72" fill="#c29163"/><text x="150" y="300" fill="white" font-size="22" font-family="sans-serif" text-anchor="middle">TEST FILM</text></svg>';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()); let body;
    if (url.pathname.startsWith('/__test/media-proxy/api/movies')) {
      const suffix = url.pathname.split('/api/movies')[1], kind = url.searchParams.get('kind') || 'movie', season = /\/season\/(\d+)$/.exec(suffix)?.[1];
      const language = url.searchParams.get('language') || '', genre = url.searchParams.get('genre') || '', sort = url.searchParams.get('sort') || 'popular';
      const LANG_IDS = { hi: 12001, ta: 12002, te: 12003, ko: 12004, ja: 12005, ml: 12007, kn: 12008, bn: 12009 };
      const variantId = language && language !== 'en' ? LANG_IDS[language] : genre ? 16000 + Number(genre) : sort === 'top-rated' ? 550 : 0;
      const variant = variantId ? { id: String(variantId), title: language ? `Title ${language}` : genre ? `Genre 16 show` : 'Top pick' } : null;
      const listable = variant ? { ...(kind === 'tv' ? tv : movie), ...variant } : (kind === 'tv' ? tv : movie);
      const json = suffix === '' ? { items: [listable], pageInfo: { page: Number(url.searchParams.get('page') || 1), hasNextPage: false } }
        : season !== undefined ? { showId: '1399', number: Number(season), episodes: [1, 2].map(number => ({ id: String(100 + number), number, seasonNumber: Number(season), showId: '1399', title: `Story ${number}`, description: 'An episode of the test series.' })) }
          : suffix.startsWith('/tv/') ? tv : movie;
      return route.fulfill({ json });
    }
    if (url.hostname === 'vidsrc.sh' || url.hostname === 'cinesrc.st') {
      const parts = url.pathname.split('/'), kind = parts[2], id = parts[3], season = Number(url.searchParams.get('s') || parts[4] || 0), episode = Number(url.searchParams.get('e') || parts[5] || 0);
      body = `<!doctype html><meta charset="utf-8"><body style="background:#142126;color:white;font:18px system-ui"><p>Controlled player fixture</p><button id="play">Play sample</button><button id="wrong">Wrong title event</button><button id="missing">Report missing</button><script>
      const data={type:'PLAYER_EVENT',data:{player_info:{tmdb:${JSON.stringify(id)},mediaType:${JSON.stringify(kind)},season:${season},episode:${episode}},player_status:'playing',player_progress:42,player_duration:300}};
      document.querySelector('#play').onclick=()=>parent.postMessage(data,'*');
      document.querySelector('#wrong').onclick=()=>parent.postMessage({...data,data:{...data.data,player_info:{...data.data.player_info,tmdb:999999}}},'*');
      document.querySelector('#missing').onclick=()=>parent.postMessage({type:'MEDIA_NOT_FOUND'},'*');</script>`;
      return route.fulfill({ contentType: 'text/html', body });
    }
    if (url.hostname === 'image.tmdb.org') return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    if (url.origin === 'http://127.0.0.1:5175') return route.continue();
    if (url.pathname.endsWith('/firebase-database.js')) body = database;
    else if (url.pathname.endsWith('/firebase-auth.js')) body = auth;
    else if (url.pathname.endsWith('/firebase-app.js')) body = 'export const initializeApp=()=>({});';
    else if (url.hostname === 'www.youtube.com') body = 'window.YT={Player:function(){}};window.onYouTubeIframeAPIReady?.();';
    else if (url.hostname === 'accounts.google.com') body = 'window.google={accounts:{oauth2:{}}};';
    else throw Error(`Unexpected external request: ${url.origin}`);
    return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
});
test('discover, wishlist, watch and resume a movie using provider-confirmed progress', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/movies');
  await expect(page.getByRole('heading', { name: 'Movies & TV.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add Big Buck Bunny to wishlist', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Big Buck Bunny from wishlist', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'Library', exact: true }).click(); await page.getByRole('button', { name: 'Wishlist', exact: true }).click();
  await page.getByRole('button', { name: 'Open Big Buck Bunny', exact: true }).click(); await page.getByRole('button', { name: 'Watch movie', exact: true }).click();
  await expect(page).toHaveURL(/\/movies\/movie\/10378\/watch$/);
  await page.frameLocator('iframe[title="Big Buck Bunny player"]').getByRole('button', { name: 'Play sample' }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('watchparty.movie-library.v1'))?.[0]?.position)).toBe(42);
  await page.reload(); await expect(page.getByTitle('Big Buck Bunny player')).toHaveAttribute('src', /startAt=42/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('movie-player.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back to details', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue watching', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('movie-details.png'), fullPage: true }); expect(errors).toEqual([]);
});
test('features a hero and regional rows, filters into a grid and returns', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/movies');
  const hero = page.getByRole('region', { name: 'Featured tonight' });
  await expect(hero).toBeVisible();
  await expect(hero.getByRole('button', { name: 'Play Big Buck Bunny', exact: true })).toBeVisible();
  for (const name of ['Trending Now', 'Korean', 'Animated Films']) await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Bollywood', exact: true })).toHaveCount(0);
  const korean = page.getByRole('region', { name: 'Korean', exact: true });
  await korean.scrollIntoViewIfNeeded();
  await expect(korean.getByRole('button', { name: 'Details for Title ko', exact: true })).toBeVisible();
  const animated = page.getByRole('region', { name: 'Animated Films', exact: true });
  await animated.scrollIntoViewIfNeeded();
  await expect(animated.getByRole('button', { name: 'Details for Genre 16 show', exact: true })).toBeVisible();
  expect(await page.evaluate(() => { const rail = document.querySelector('[aria-label="Korean"] .movie-rail'); return Boolean(rail) && rail.scrollWidth > 0 && rail.scrollWidth >= rail.clientWidth; })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Language', { exact: true }).selectOption('hi');
  await expect(page.getByRole('button', { name: 'Details for Title hi', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Featured tonight', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show all rows', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Featured tonight', exact: true })).toBeVisible();
  await page.getByLabel('Genre', { exact: true }).selectOption('16');
  await expect(page.getByRole('button', { name: 'Details for Genre 16 show', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('movie-rows.png'), fullPage: true });
  expect(errors).toEqual([]);
});
test('chooses TV season and episode, rejects another title event and changes episodes safely', async ({ page }, info) => {
  await page.goto('/movies/tv/1399'); await page.getByLabel('Season', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Watch episode 2', exact: true }).click();
  await expect(page).toHaveURL(/\/movies\/tv\/1399\/watch\/2\/2$/);
  const player = page.frameLocator('iframe[title="The test series player"]');
  await player.getByRole('button', { name: 'Wrong title event' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('watchparty.movie-library.v1')) || [])).toEqual([]);
  await player.getByRole('button', { name: 'Play sample' }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('watchparty.movie-library.v1'))?.[0]?.episode)).toBe(2);
  await page.getByRole('button', { name: 'Previous episode', exact: true }).click();
  await expect(page).toHaveURL(/\/movies\/tv\/1399\/watch\/2\/1$/);
  await expect(page.getByTitle('The test series player')).not.toHaveAttribute('src', /startAt=/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('tv-player.png'), fullPage: true });
});
test('provider-reported missing content has retry feedback and invalid addresses open no player', async ({ page }) => {
  await page.goto('/movies/movie/10378/watch');
  await page.frameLocator('iframe[title="Big Buck Bunny player"]').getByRole('button', { name: 'Report missing' }).click();
  await expect(page.getByRole('alert')).toContainText('unavailable'); await page.getByRole('button', { name: 'Retry player', exact: true }).click();
  await expect(page.getByTitle('Big Buck Bunny player')).toBeVisible();
  await page.goto('/movies/tv/1399/watch'); await expect(page.getByRole('heading', { name: 'Title unavailable', exact: true })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});
