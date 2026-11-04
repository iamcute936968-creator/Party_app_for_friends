import { expect, test } from '@playwright/test';
import { fulfillAnimeFixture } from '../helpers/anime-hls-fixture';
const movie = { id: '10378', mediaKind: 'movie', title: 'Big Buck Bunny', genres: [], seasons: [], description: '', externalIds: {} };
const player = `<!doctype html><video muted playsinline controls src="https://stream.animeparadise.moe/m3u8?url=room-fixture"></video><script>
const video=document.querySelector('video'),send=(type,data={})=>parent.postMessage({type:'cinesrc:'+type,...data},'http://127.0.0.1:5175');
for(const event of ['play','pause','ended','loadedmetadata','timeupdate','seeking'])video.addEventListener(event,()=>send(event,{currentTime:video.currentTime,duration:video.duration}));
addEventListener('message',e=>{if(e.source!==parent||e.origin!=='http://127.0.0.1:5175'||e.data?.type!=='cinesrc:command')return;const {command,args}=e.data;
if(command==='play')video.play().catch(()=>{});else if(command==='pause')video.pause();else if(command==='seek')video.currentTime=args[0];else if(command==='getCurrentTime')send('response',{command,result:video.currentTime});else if(command==='getDuration')send('response',{command,result:video.duration});});setTimeout(()=>send('ready'),0);</script>`;
test('movie rooms synchronize native iframe playback, late join, host seeking, selection changes and reconnect', async ({ browser }, info) => {
  test.setTimeout(90000); const contexts = [], errors = [];
  const client = async (width = 1440) => {
    const context = await browser.newContext({ viewport: { width, height: 900 } }); contexts.push(context);
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      if (await fulfillAnimeFixture(route)) return;
      const u = new URL(route.request().url()); let body;
      if (u.pathname.includes('/api/movies')) {
        const tv = u.pathname.includes('/tv/');
        return route.fulfill({ json: u.pathname.includes('/season/') ? { showId: '1399', number: 1, episodes: [1, 2].map(number => ({ id: String(number), showId: '1399', seasonNumber: 1, number })) } : { ...movie, id: u.pathname.split('/').pop(), mediaKind: tv ? 'tv' : 'movie', seasons: tv ? [{ number: 1 }] : [] } });
      }
      if (u.origin === 'https://cinesrc.st') return route.fulfill({ contentType: 'text/html', body: player });
      if (u.origin === 'http://127.0.0.1:5175' && u.pathname === '/src/firebaseClient.js') body = "export {database,ensureFirebaseUser,firebaseAuth,accountSdk} from '/tests/rtc/firebase-emulator-client.js';";
      else if (['http://127.0.0.1:5175', 'http://127.0.0.1:9000', 'http://127.0.0.1:9099'].includes(u.origin)) return route.continue();
      else if (u.pathname.endsWith('/firebase-database.js')) body = "export * from 'http://127.0.0.1:5175/tests/rtc/firebase-emulator-client.js';";
      else if (u.hostname === 'www.youtube.com') body = 'window.YT={};window.onYouTubeIframeAPIReady?.();';
      else if (u.hostname === 'accounts.google.com') body = 'window.google={accounts:{oauth2:{}}};';
      else throw Error('Unexpected movie sync fixture request: ' + u.origin);
      return route.fulfill({ contentType: 'text/javascript', body, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.qaInvite = text; } } }));
    return page;
  };
  const video = page => page.frameLocator('iframe[title="Room movie player"]').locator('video');
  const position = page => video(page).evaluate(v => v.currentTime);
  try {
    const host = await client(); await host.goto('/movies/movie/10378'); await host.getByRole('button', { name: 'Watch together', exact: true }).click();
    await host.getByLabel('Your name', { exact: true }).fill('Host'); await host.getByRole('button', { name: 'Create Room', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Play', exact: true })).toBeEnabled(); await host.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(() => position(host)).toBeGreaterThan(.5); await host.getByRole('button', { name: 'Copy invite', exact: true }).click();
    const member = await client(390); await member.goto(await host.evaluate(() => window.qaInvite)); await member.getByLabel('Your name', { exact: true }).fill('Guest'); await member.getByRole('button', { name: 'Join Room', exact: true }).click();
    await expect.poll(() => position(member)).toBeGreaterThan(.3); await expect.poll(async () => Math.abs(await position(host) - await position(member))).toBeLessThan(1.5);
    await expect(member.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
    await host.getByRole('button', { name: 'Pause', exact: true }).click(); await expect.poll(() => video(member).evaluate(v => v.paused)).toBe(true);
    const slider = host.getByRole('slider', { name: 'Video timeline' }), duration = await video(host).evaluate(v => v.duration), bounds = await slider.boundingBox();
    await slider.click({ position: { x: bounds.width * .6, y: bounds.height / 2 } }); await expect.poll(() => position(member)).toBeGreaterThan(duration * .5);
    await host.getByRole('button', { name: 'Play', exact: true }).click(); await expect.poll(() => position(member)).toBeGreaterThan(duration * .6 + .2);
    await expect(member.getByRole('status', { name: 'Playback buffering' })).toHaveCount(0);
    await member.evaluate(() => { window.qaRetiredMovie = document.querySelector('iframe[title="Room movie player"]').contentWindow; });
    for (const link of ['/movies/tv/1399/watch/1/1', '/movies/tv/1399/watch/1/2']) {
      await host.getByLabel('Video URL', { exact: true }).fill('http://127.0.0.1:5175' + link); await host.getByRole('button', { name: 'Load video', exact: true }).click();
      await expect(member.getByTitle('Room movie player')).toHaveAttribute('src', link.endsWith('/1') ? /[?&]e=1(?:&|$)/ : /[?&]e=2(?:&|$)/);
      await expect.poll(() => position(member)).toBeLessThan(.2);
    }
    await host.getByRole('button', { name: 'Play', exact: true }).click(); await expect.poll(() => position(member)).toBeGreaterThan(.3);
    await member.evaluate(async () => { const s = await import('/tests/rtc/firebase-emulator-client.js'); s.goOffline(s.database); s.goOnline(s.database); window.dispatchEvent(new MessageEvent('message', { origin: 'https://cinesrc.st', source: window.qaRetiredMovie, data: { type: 'cinesrc:pause' } })); });
    await expect.poll(async () => Math.abs(await position(host) - await position(member))).toBeLessThan(1.5);
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await member.screenshot({ path: info.outputPath('movie-sync-mobile.png'), fullPage: false });
    await member.getByRole('button', { name: 'Leave room', exact: true }).click(); await expect(member.getByTitle('Room movie player')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(c => c.close())); }
});
