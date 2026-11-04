import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const databaseFixture = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const firebaseAuthFixture = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
const guestFilm = { source: 'youtube', id: 'abcdefghijk', title: 'Guest Friday film', position: 40, duration: 100,
  wishlist: true, completed: false, updatedAt: 20, lastWatchedAt: 20 };
const photoURL = 'https://lh3.googleusercontent.com/fixture-photo';

async function openApp(page, guestItems = []) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.addInitScript(items => localStorage.setItem('watchparty.viewing-library.v1', JSON.stringify(items)), guestItems);
  await page.route('**/*', async route => {
    const target = new URL(route.request().url());
    if (target.origin === 'http://127.0.0.1:5175' && target.pathname === '/__test/media-proxy/api/uploads/config')
      return route.fulfill({ json: { enabled: false } });
    if (target.origin === 'http://127.0.0.1:5175') return route.continue();
    let body;
    if (target.pathname.endsWith('/firebase-database.js')) body = databaseFixture;
    else if (target.pathname.endsWith('/firebase-auth.js')) body = firebaseAuthFixture;
    else if (target.pathname.endsWith('/firebase-app.js')) body = 'export const initializeApp = () => ({});';
    else if (target.hostname === 'www.youtube.com') body = 'window.YT = {Player: function(){}}; window.onYouTubeIframeAPIReady?.();';
    else if (target.hostname === 'accounts.google.com') body = 'window.google = {accounts: {oauth2: {}}};';
    else if (target.hostname === 'lh3.googleusercontent.com') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="coral"/></svg>' });
    else { errors.push(`Unexpected external request: ${target.origin}`); return route.abort(); }
    return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
  await page.goto('/account');
  await expect(page).toHaveTitle('Watch Party | Watch together');
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  return errors;
}

async function readValue(page, path) {
  return page.evaluate(async path => {
    const sdk = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js');
    return (await sdk.get(sdk.ref(null, path))).val();
  }, path);
}
async function authState(page) {
  return page.evaluate(async () => {
    const sdk = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');
    const user = sdk.getAuth().currentUser;
    return user ? { uid: user.uid, isAnonymous: user.isAnonymous } : null;
  });
}

test('Google linking locks room entry, retains UID and imports guest history only explicitly', async ({ page }, testInfo) => {
  const errors = await openApp(page, [guestFilm]);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: `Choose ${guestFilm.title}` })).toBeVisible();
  await page.getByRole('link', { name: 'Watch Together', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Guest');
  await page.getByLabel('Room code or invite link').fill('ROOM_A');
  const create = page.getByRole('button', { name: 'Create Room', exact: true });
  const join = page.getByRole('button', { name: 'Join Room', exact: true });
  await expect(create).toBeEnabled(); await expect(join).toBeEnabled();
  await page.evaluate(() => window.holdGooglePopup?.());
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(page.getByText('Updating your account…', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Watch Together', exact: true }).click();
  await expect(create).toBeDisabled(); await expect(join).toBeDisabled();
  await expect(page.getByLabel('Your name', { exact: true })).toBeDisabled();
  await page.evaluate(() => window.releaseGooglePopup?.());
  await expect(create).toBeEnabled(); await expect(join).toBeEnabled();
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  expect(await authState(page)).toEqual({ uid: 'fixture-user', isAnonymous: false });
  await expect(page.getByText('Cloud library is up to date.', { exact: true })).toBeVisible();
  expect(await readValue(page, 'accounts/fixture-user/library')).toBeNull();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: `Choose ${guestFilm.title}` })).toHaveCount(0);
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Import guest library', exact: true }).click();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: `Choose ${guestFilm.title}` })).toBeVisible();
  const stored = await readValue(page, 'accounts/fixture-user/library');
  expect(Object.keys(stored)).toEqual(['0']);
  expect(Object.values(stored)[0]).toMatchObject({ id: guestFilm.id, position: 40, wishlist: true });
  await page.screenshot({ path: testInfo.outputPath('account-library-import.png'), fullPage: true });
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  expect((await authState(page)).isAnonymous).toBe(true);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: `Choose ${guestFilm.title}` })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('watchparty.viewing-library.v1')))).toEqual([guestFilm]);
  expect(errors).toEqual([]);
});

test('Google collision keeps the guest identity until explicit existing-account choice', async ({ page }, testInfo) => {
  const errors = await openApp(page, [guestFilm]);
  await page.evaluate(async () => {
    const sdk = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js');
    await sdk.set(sdk.ref(null, 'accounts/fixture-user/library'), { 0: { source: 'drive', id: 'private_previous', title: 'Previous account film', position: 20, duration: 100, updatedAt: 30, lastWatchedAt: 30 } });
    window.setGooglePopupCollision?.(true);
  });
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use existing Google account', exact: true })).toBeVisible();
  expect(await authState(page)).toEqual({ uid: 'fixture-user', isAnonymous: true });
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: `Choose ${guestFilm.title}` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Use existing Google account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  expect(await authState(page)).toEqual({ uid: 'fixture-existing-user', isAnonymous: false });
  await expect(page.getByRole('heading', { name: 'Returning movie fan', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: `Choose ${guestFilm.title}` })).toHaveCount(0);
  await expect(page.getByText('Previous account film', { exact: true })).toHaveCount(0);
  expect(await readValue(page, 'accounts/fixture-existing-user/library')).toBeNull();
  expect(Object.values(await readValue(page, 'accounts/fixture-user/library'))[0].id).toBe('private_previous');
  await page.screenshot({ path: testInfo.outputPath('account-existing-collision.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('saved profile stays canonical, photo sharing is opt-in and remote profile changes sync', async ({ page }, testInfo) => {
  const errors = await openApp(page);
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  const name = page.getByLabel('Display name', { exact: true });
  await expect(name).toHaveValue('Movie fan');
  await expect(name).toHaveAttribute('maxlength', '40');
  const consent = page.getByRole('checkbox', { name: 'Share Google photo with room' });
  await expect(consent).not.toBeChecked();
  await expect(page.locator('.account-avatar img')).toHaveCount(0);
  expect(await readValue(page, 'accounts/fixture-user/profile')).toBeNull();
  await name.fill('  <b>Movie friend</b>  ');
  await consent.check();
  await expect(page.locator('.account-avatar img')).toHaveAttribute('src', photoURL);
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect.poll(() => readValue(page, 'accounts/fixture-user/profile')).toEqual({ displayName: '<b>Movie friend</b>', photoURL, sharePhoto: true });
  await expect(name).toHaveValue('<b>Movie friend</b>');
  await expect(page.getByRole('heading', { name: '<b>Movie friend</b>', exact: true })).toBeVisible();
  await expect(page.locator('.account-panel b')).toHaveCount(0);
  await expect(page.getByText('private-google@example.test', { exact: true })).toHaveCount(0);
  await page.evaluate(async photoURL => {
    const sdk = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js');
    await sdk.set(sdk.ref(null, 'accounts/fixture-user/profile'), { displayName: 'Remote movie friend', photoURL, sharePhoto: false, email: 'private-google@example.test' });
  }, photoURL);
  await expect(name).toHaveValue('Remote movie friend');
  await expect(consent).not.toBeChecked();
  await expect(page.locator('.account-avatar img')).toHaveCount(0);
  await expect(page.getByText('private-google@example.test', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('account-profile-consent.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
