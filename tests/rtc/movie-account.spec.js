import { expect, test } from '@playwright/test';
const item = { id: '10378', mediaKind: 'movie', title: 'Account movie', description: '', genres: [], seasons: [] };
const guest = { kind: 'movie', id: '10378', title: item.title, wishlist: true, position: 42, duration: 300, season: 0, episode: 0, completed: false, updatedAt: 20, lastWatchedAt: 20 };
test('real Auth and RTDB emulators synchronize a private movie wishlist and confirmed watch position', async ({ browser }, info) => {
  test.setTimeout(90000); const contexts = [], errors = [];
  const makePage = async (subject, withGuest = false) => {
    const context = await browser.newContext(); contexts.push(context); const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ subject, guest }) => { window.testGoogleSubject = subject; if (guest) localStorage.setItem('watchparty.movie-library.v1', JSON.stringify([guest])); }, { subject, guest: withGuest ? guest : null });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url()); let body;
      if (url.pathname.startsWith('/__test/media-proxy/api/movies')) return route.fulfill({ json: url.pathname.endsWith('/api/movies') ? { items: [item], pageInfo: { page: 1, hasNextPage: false } } : item });
      if (url.hostname === 'vidsrc.sh') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><button id="play">Play sample</button><script>document.querySelector('button').onclick=()=>parent.postMessage({type:'PLAYER_EVENT',data:{player_info:{tmdb:10378,mediaType:'movie'},player_status:'playing',player_progress:80,player_duration:300}},'*');</script>` });
      if (url.pathname === '/src/firebaseClient.js') body = "export {database,ensureFirebaseUser,firebaseAuth,accountSdk} from '/tests/rtc/firebase-emulator-account-client.js';";
      else if (['http://127.0.0.1:5175', 'http://127.0.0.1:9000', 'http://127.0.0.1:9099'].includes(url.origin)) return route.continue();
      else if (url.pathname.endsWith('/firebase-database.js')) body = "export * from 'http://127.0.0.1:5175/tests/rtc/firebase-emulator-client.js';";
      else if (url.hostname === 'www.youtube.com') body = 'window.YT={Player:function(){}};window.onYouTubeIframeAPIReady?.();';
      else if (url.hostname === 'accounts.google.com') body = 'window.google={accounts:{oauth2:{}}};';
      else { errors.push(`Unexpected external request: ${url.origin}`); return route.abort(); }
      return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
    });
    await page.goto('/account'); await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible(); return page;
  };
  const value = (page, uid) => page.evaluate(async uid => { const sdk = await import('/tests/rtc/firebase-emulator-client.js'); return (await sdk.get(sdk.ref(sdk.database, `accounts/${uid}/movieLibrary`))).val(); }, uid);
  try {
    const subject = `movies-${Date.now()}-${info.workerIndex}`, first = await makePage(subject, true);
    const uid = await first.evaluate(async () => (await import('/tests/rtc/firebase-emulator-account-client.js')).firebaseAuth.currentUser.uid);
    expect(await value(first, uid)).toBeNull(); await first.goto('/movies'); await first.getByRole('button', { name: 'Import guest movies', exact: true }).click();
    await expect.poll(async () => Object.values(await value(first, uid) || {})[0]?.position).toBe(42);
    const second = await makePage(subject); await second.goto('/movies/movie/10378/watch');
    await expect(second.getByTitle('Account movie player')).toHaveAttribute('src', /startAt=42/);
    await second.frameLocator('iframe[title="Account movie player"]').getByRole('button', { name: 'Play sample' }).click();
    await expect.poll(async () => Object.values(await value(first, uid) || {})[0]?.position).toBe(80);
    await first.goto('/movies/movie/10378/watch'); await expect(first.getByTitle('Account movie player')).toHaveAttribute('src', /startAt=80/);
    const other = await makePage(`${subject}-other`);
    expect(await other.evaluate(async uid => { const sdk = await import('/tests/rtc/firebase-emulator-client.js'); try { await sdk.get(sdk.ref(sdk.database, `accounts/${uid}/movieLibrary`)); return false; } catch { return true; } }, uid)).toBe(true);
    await other.goto('/movies'); await other.getByRole('button', { name: 'Wishlist', exact: true }).click(); await expect(other.getByRole('button', { name: 'Open Account movie', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
