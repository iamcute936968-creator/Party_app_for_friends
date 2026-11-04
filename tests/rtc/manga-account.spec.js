import { expect, test } from '@playwright/test';
const id = '58be6aa6-06cb-4ca5-bd20-f1392ce451fb', chapterId = 'ff4f79de-6102-4610-8327-539904cfe549';
const item = { id, title: 'Account reader story', description: '', genres: [], authors: [] };
const chapter = { id: chapterId, mangaId: id, number: '1', title: '', pageCount: 5, groups: [], external: false };
const guest = { id, title: item.title, chapterId, page: 1, saved: true, updatedAt: 20 };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+rK1kAAAAASUVORK5CYII=', 'base64');
test('real Auth and RTDB emulators keep manga private and resume the same account across browsers', async ({ browser }, info) => {
  test.setTimeout(90000); const contexts = [], errors = [];
  const makePage = async (subject, withGuest = false) => {
    const context = await browser.newContext(); contexts.push(context); const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ subject, guest }) => { window.testGoogleSubject = subject; if (guest) localStorage.setItem('watchparty.manga-library.v1', JSON.stringify([guest])); }, { subject, guest: withGuest ? guest : null });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url()); let body;
      if (url.pathname.startsWith('/__test/media-proxy/api/manga')) {
        const suffix = url.pathname.split('/api/manga')[1];
        if (suffix.endsWith('/cover') || suffix.includes('/pages/')) return route.fulfill({ contentType: 'image/png', body: png });
        return route.fulfill({ json: suffix === '' ? { items: [item], pageInfo: { page: 1, hasNextPage: false } } : suffix.endsWith(`/chapters/${chapterId}`) ? chapter : item });
      }
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
  const value = (page, uid) => page.evaluate(async uid => {
    const sdk = await import('/tests/rtc/firebase-emulator-client.js');
    return (await sdk.get(sdk.ref(sdk.database, `accounts/${uid}/mangaLibrary`))).val();
  }, uid);
  try {
    const subject = `manga-${Date.now()}-${info.workerIndex}`, first = await makePage(subject, true);
    const uid = await first.evaluate(async () => (await import('/tests/rtc/firebase-emulator-account-client.js')).firebaseAuth.currentUser.uid);
    expect(await value(first, uid)).toBeNull();
    await first.goto('/manga'); await first.getByRole('button', { name: 'Import guest manga', exact: true }).click();
    await expect.poll(async () => Object.values(await value(first, uid) || {})[0]?.page).toBe(1);
    const second = await makePage(subject);
    await second.goto(`/manga/${id}/read/${chapterId}`);
    await expect(second.getByRole('img', { name: 'Page 2 of 5', exact: true })).toBeVisible();
    await second.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect.poll(async () => Object.values(await value(first, uid) || {})[0]?.page).toBe(2);
    await first.goto(`/manga/${id}/read/${chapterId}`);
    await expect(first.getByRole('img', { name: 'Page 3 of 5', exact: true })).toBeVisible();
    const other = await makePage(`${subject}-other`);
    expect(await other.evaluate(async uid => {
      const sdk = await import('/tests/rtc/firebase-emulator-client.js');
      try { await sdk.get(sdk.ref(sdk.database, `accounts/${uid}/mangaLibrary`)); return false; } catch { return true; }
    }, uid)).toBe(true);
    await other.goto('/manga'); await other.getByRole('button', { name: 'Continue reading', exact: true }).click();
    await expect(other.getByText('Chapters you read will appear here.', { exact: true })).toBeVisible();
    await first.screenshot({ path: info.outputPath('manga-real-rtdb-resume.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
import { Buffer } from 'node:buffer';
