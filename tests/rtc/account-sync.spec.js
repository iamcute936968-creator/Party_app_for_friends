import { expect, test } from '@playwright/test';

const guestFilm = { source: 'youtube', id: 'abcdefghijk', title: 'Emulator guest film', position: 40, duration: 100,
  wishlist: true, completed: false, updatedAt: 20, lastWatchedAt: 20 };
const helper = '/tests/rtc/firebase-emulator-account-client.js';
const guestAnime = { id: '98444', title: 'Laid-Back Camp', updatedAt: 20 };
const guestParadise = { id: 'ap_naruto', title: 'Naruto', updatedAt: 21 };

async function authState(page) {
  return page.evaluate(async () => {
    const { firebaseAuth } = await import('/tests/rtc/firebase-emulator-account-client.js');
    const user = firebaseAuth.currentUser;
    return user ? { uid: user.uid, isAnonymous: user.isAnonymous } : null;
  });
}
async function libraryValue(page, uid) {
  return page.evaluate(async uid => {
    const sdk = await import('/tests/rtc/firebase-emulator-client.js');
    return (await sdk.get(sdk.ref(sdk.database, `accounts/${uid}/library`))).val();
  }, uid);
}

test('real Auth and RTDB emulators sync one account across browsers and enforce account isolation', async ({ browser }, info) => {
  test.setTimeout(90000);
  const contexts = [], errors = [];
  const subject = `account-sync-${Date.now()}-${info.workerIndex}`;
  const makePage = async (googleSubject, guestItems = []) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url()); let body;
      if (url.pathname === '/__test/media-proxy/api/uploads/config') return route.fulfill({ json: { enabled: false } });
      if (['/__test/media-proxy/api/anime', '/__test/media-proxy/api/paradise'].includes(url.pathname)) return route.fulfill({ json: {
        items: [], source: 'curated', pageInfo: { page: 1, hasNextPage: false }, notice: 'Local test catalog.' } });
      if (url.origin === 'http://127.0.0.1:5175' && url.pathname === '/src/firebaseClient.js') {
        body = `export {database,ensureFirebaseUser,firebaseAuth,accountSdk} from '${helper}';`;
      } else if (['http://127.0.0.1:5175', 'http://127.0.0.1:9000', 'http://127.0.0.1:9099'].includes(url.origin)) return route.continue();
      else if (url.pathname.endsWith('/firebase-database.js')) body = "export * from 'http://127.0.0.1:5175/tests/rtc/firebase-emulator-client.js';";
      else if (url.hostname === 'www.youtube.com') body = 'window.YT={Player:function(){}};window.onYouTubeIframeAPIReady?.();';
      else if (url.hostname === 'accounts.google.com') body = 'window.google={accounts:{oauth2:{}}};';
      else { errors.push(`Unexpected external request: ${url.origin}`); return route.abort(); }
      return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
    });
    await page.addInitScript(({ googleSubject, guestItems, guestAnime, guestParadise }) => {
      window.testGoogleSubject = googleSubject;
      localStorage.setItem('watchparty.viewing-library.v1', JSON.stringify(guestItems));
      localStorage.setItem('watchparty.anime-favorites.v1', JSON.stringify(guestItems.length ? [guestAnime] : []));
      localStorage.setItem('watchparty.paradise-favorites.v1', JSON.stringify(guestItems.length ? [guestParadise] : []));
    }, { googleSubject, guestItems, guestAnime, guestParadise });
    await page.goto('/account');
    await expect(page).toHaveTitle('Watch Party | Watch together');
    await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    return page;
  };
  try {
    const first = await makePage(subject, [guestFilm]);
    const anonymousUid = await first.evaluate(async () => (await (await import('/tests/rtc/firebase-emulator-account-client.js')).ensureFirebaseUser()).uid);
    await first.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(first.getByRole('button', { name: `Choose ${guestFilm.title}` })).toBeVisible();
    await first.getByRole('button', { name: 'Wishlist', exact: true }).click();
    await expect(first.getByRole('button', { name: 'Open Laid-Back Camp', exact: true })).toBeVisible();
    await expect(first.getByRole('button', { name: 'Open Naruto', exact: true })).toBeVisible();
    await first.getByRole('link', { name: 'Account', exact: true }).click();
    await first.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await expect(first.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    const owner = await authState(first);
    expect(owner).toEqual({ uid: anonymousUid, isAnonymous: false });
    await expect(first.getByText('Cloud library is up to date.', { exact: true })).toBeVisible();
    expect(await libraryValue(first, owner.uid)).toBeNull();
    await first.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(first.getByRole('button', { name: `Choose ${guestFilm.title}` })).toHaveCount(0);
    await expect(first.getByRole('button', { name: 'Open Laid-Back Camp', exact: true })).toHaveCount(0);
    await first.getByRole('link', { name: 'Anime', exact: true }).click();
    await first.getByRole('button', { name: 'Import saved anime', exact: true }).click();
    await first.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(first.getByRole('button', { name: 'Open Laid-Back Camp', exact: true })).toBeVisible();
    await first.getByRole('link', { name: 'Account', exact: true }).click();
    await first.getByRole('button', { name: 'Import guest library', exact: true }).click();
    await first.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(first.getByRole('button', { name: `Choose ${guestFilm.title}` })).toBeVisible();
    await expect.poll(async () => Object.values(await libraryValue(first, owner.uid) || {})[0]?.position).toBe(40);

    const second = await makePage(subject);
    await second.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await expect(second.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    expect(await authState(second)).toEqual(owner);
    await second.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(second.getByRole('button', { name: `Choose ${guestFilm.title}` })).toBeVisible();
    await second.getByRole('button', { name: 'Wishlist', exact: true }).click();
    await expect(second.getByRole('button', { name: 'Open Laid-Back Camp', exact: true })).toBeVisible();
    await expect(second.getByRole('button', { name: 'Open Naruto', exact: true })).toBeVisible();
    await second.getByRole('button', { name: 'Remove Naruto from saved anime', exact: true }).click();
    await expect(first.getByRole('button', { name: 'Open Naruto', exact: true })).toHaveCount(0);
    await second.getByRole('button', { name: 'Remove Laid-Back Camp from saved anime', exact: true }).click();
    await expect(first.getByRole('button', { name: 'Open Laid-Back Camp', exact: true })).toHaveCount(0);
    await second.getByRole('button', { name: 'Wishlist', exact: true }).click();
    await second.getByLabel('Save a video link', { exact: true }).fill('https://youtu.be/zyxwvutsrqp');
    await second.getByLabel('Video title (optional)', { exact: true }).fill('Shared second film');
    await second.getByRole('button', { name: 'Save to wishlist', exact: true }).click();
    await expect(second.getByRole('button', { name: 'Remove Shared second film from wishlist' })).toBeVisible();
    await first.getByRole('button', { name: 'Wishlist', exact: true }).click();
    await expect(first.getByRole('button', { name: 'Remove Shared second film from wishlist' })).toBeVisible();
    await first.getByRole('button', { name: 'Remove Shared second film from wishlist' }).click();
    await expect(second.getByRole('button', { name: 'Remove Shared second film from wishlist' })).toHaveCount(0);
    expect(Object.values(await libraryValue(second, owner.uid)).find(item => item.id === guestFilm.id).position).toBe(40);

    for (const page of [first, second]) await page.getByRole('link', { name: 'Account', exact: true }).click();
    await second.getByLabel('Display name', { exact: true }).fill('  Emulator movie friends  ');
    await second.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(first.getByLabel('Display name', { exact: true })).toHaveValue('Emulator movie friends');
    await expect(first.getByRole('heading', { name: 'Emulator movie friends', exact: true })).toBeVisible();
    await first.screenshot({ path: info.outputPath('account-real-rtdb-first.png'), fullPage: true });
    await second.screenshot({ path: info.outputPath('account-real-rtdb-second.png'), fullPage: true });

    await first.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(first.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
    await expect.poll(() => authState(first)).toMatchObject({ isAnonymous: true });
    const guest = await authState(first);
    expect(guest.isAnonymous).toBe(true); expect(guest.uid).not.toBe(owner.uid);
    expect(await first.evaluate(() => JSON.parse(localStorage.getItem('watchparty.viewing-library.v1')))).toEqual([guestFilm]);
    await first.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(first.getByRole('button', { name: `Choose ${guestFilm.title}` })).toBeVisible();
    await expect(second.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();

    const third = await makePage(`${subject}-other`);
    await third.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await expect(third.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    const stranger = await authState(third);
    expect(stranger.uid).not.toBe(owner.uid);
    await expect(third.getByText('Cloud library is up to date.', { exact: true })).toBeVisible();
    expect(await libraryValue(third, stranger.uid)).toBeNull();
    await third.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(third.getByRole('button', { name: `Choose ${guestFilm.title}` })).toHaveCount(0);
    for (const page of [first, third]) {
      expect(await page.evaluate(async uid => {
        const sdk = await import('/tests/rtc/firebase-emulator-client.js');
        try { await sdk.get(sdk.ref(sdk.database, `accounts/${uid}/library`)); return false; }
        catch { return true; }
      }, owner.uid)).toBe(true);
    }
    expect(await third.evaluate(async uid => {
      const sdk = await import('/tests/rtc/firebase-emulator-client.js');
      try { await sdk.set(sdk.ref(sdk.database, `accounts/${uid}/profile`), { displayName: 'Forged name', photoURL: '', sharePhoto: false }); return false; }
      catch { return true; }
    }, owner.uid)).toBe(true);
    await expect(second.getByLabel('Display name', { exact: true })).toHaveValue('Emulator movie friends');
    await third.screenshot({ path: info.outputPath('account-real-rtdb-isolated.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
