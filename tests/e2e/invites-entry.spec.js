import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const databaseFixture = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const firebaseAuthFixture = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
async function openApp(page, url = '/') {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  page.on('dialog', async (dialog) => { errors.push('Unexpected blocking dialog'); await dialog.dismiss(); });
  await page.route('**/*', async (route) => {
    const target = new URL(route.request().url());
    if (target.origin === 'http://127.0.0.1:5175') return route.continue();
    let body;
    if (target.pathname.endsWith('/firebase-database.js')) body = databaseFixture;
    else if (target.pathname.endsWith('/firebase-auth.js')) body = firebaseAuthFixture;
    else if (target.pathname.endsWith('/firebase-app.js')) body = 'export const initializeApp = () => ({});';
    else if (target.hostname === 'www.youtube.com') body = 'window.YT = {Player: function(){}}; window.onYouTubeIframeAPIReady?.();';
    else if (target.hostname === 'accounts.google.com') body = 'window.google = {accounts: {oauth2: {}}};';
    else throw new Error(`Unexpected external request to ${target.origin}`);
    return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
  await page.addInitScript(() => {
    window.testCopiedInvites = [];
    window.testCopyMode = 'reject';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => {
      if (window.testCopyMode === 'reject') throw new Error('private clipboard error');
      window.testCopiedInvites.push(value);
    } } });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (value) => {
      if (window.testShareMode === 'cancel') throw new DOMException('Cancelled', 'AbortError');
      if (window.testShareMode === 'reject') throw new Error('private share error');
      window.testSharedInvite = value;
    } });
  });
  await page.goto(url);
  await expect(page).toHaveTitle('Watch Party | Watch together');
  await expect(page.getByLabel('Your name')).toBeVisible();
  return errors;
}

test('entry errors retain fields, block duplicate pending requests, and recover', async ({ page }, testInfo) => {
  const errors = await openApp(page);
  const name = page.getByLabel('Your name');
  const room = page.getByLabel('Room code or invite link');
  const join = page.getByRole('button', { name: 'Join Room', exact: true });
  await name.fill('Guest');
  await room.fill('ROOM/OTHER');
  await join.click();
  await expect(page.getByRole('alert')).toHaveText('Enter a room code or a valid invite link.');
  await room.fill('MISSING');
  await join.click();
  await expect(page.getByRole('alert')).toHaveText('Use the full invite link to join this private room.');
  await room.fill('ROOM_A');
  await page.evaluate(() => window.rejectNextTestRoomRead());
  await join.click();
  await expect(page.getByRole('alert')).toHaveText('Could not join the room. Try again.');
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(name).toHaveValue('Guest');
  await expect(room).toHaveValue('ROOM_A');
  await expect(page.getByText('private Firebase entry detail')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('entry-error.png'), fullPage: true });
  const before = await page.evaluate(() => window.testRoomReadCount);
  await page.evaluate(() => window.pauseNextTestRoomRead());
  await page.locator('#join-room').evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
  await expect(page.getByRole('button', { name: 'Joining...', exact: true })).toBeDisabled();
  await expect(name).toBeDisabled();
  await expect(room).toBeDisabled();
  expect(await page.evaluate(() => window.testRoomReadCount)).toBe(before + 1);
  await page.evaluate(() => window.releaseTestRoomRead());
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friday movie');
  expect(errors).toEqual([]);
});

test('copy denial, retry, native sharing, cancellation and manual fallback', async ({ page }, testInfo) => {
  const errors = await openApp(page);
  await page.evaluate(async () => {
    const sdk = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js');
    await sdk.update(sdk.ref(null, 'rooms/ROOM_A'), { secret: 'fixture +&', roomSecret: 'fixture +&' });
    await sdk.update(sdk.ref(null, 'roomAccess/ROOM_A/fixture-host'), { secret: 'fixture +&' });
  });
  await page.getByLabel('Your name').fill('Guest');
  await page.getByLabel('Room code or invite link').fill('https://party.example/watch?room=ROOM_A&s=fixture%20%2B%26');
  await page.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friday movie');
  await page.evaluate(() => window.setTestConnection(true));
  const before = await page.evaluate(() => window.testPlaybackState('ROOM_A'));
  await page.getByRole('button', { name: 'Copy invite', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Could not copy the invite. Copy the link below.');
  const fallback = page.getByLabel('Invite link');
  const invite = new URL(await fallback.inputValue());
  expect(invite.origin).toBe('http://127.0.0.1:5175');
  expect(invite.searchParams.get('room')).toBe('ROOM_A');
  expect(invite.searchParams.get('s')).toBe('fixture +&');
  await fallback.focus();
  expect(await fallback.evaluate((input) => input.selectionEnd - input.selectionStart === input.value.length)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('invite-manual.png'), fullPage: true });
  await page.evaluate(() => { window.testCopyMode = 'success'; });
  await page.getByRole('button', { name: 'Copy invite', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Invite copied', exact: true })).toBeVisible();
  await expect(fallback).toHaveCount(0);
  expect(await page.evaluate(() => window.testCopiedInvites)).toEqual([invite.href]);
  await page.getByRole('button', { name: 'Share invite', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Invite feedback' })).toHaveText('Share options opened.');
  expect(await page.evaluate(() => window.testSharedInvite.url)).toBe(invite.href);
  await page.evaluate(() => { window.testShareMode = 'cancel'; });
  await page.getByRole('button', { name: 'Share invite', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(fallback).toHaveCount(0);
  await page.evaluate(() => { window.testShareMode = 'reject'; });
  await page.getByRole('button', { name: 'Share invite', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Could not share the invite. Copy the link below.');
  expect(await page.evaluate(() => window.testPlaybackState('ROOM_A'))).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('create failures can retry and an initial invite secret stays with its original room', async ({ page }) => {
  const errors = await openApp(page, '/?room=ROOM_A&s=initial-fixture-secret');
  await page.getByLabel('Your name').fill('Guest');
  await page.evaluate(() => window.rejectNextTestRoomCreate());
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Could not create the room. Try again.');
  await expect(page.getByLabel('Your name')).toHaveValue('Guest');
  await page.evaluate(() => window.seedTestAlternateRoom());
  await page.getByLabel('Room code or invite link').fill('https://invite.example/?room=ROOM_B&s=fixture-secret-b');
  await page.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Another movie');
  await page.getByRole('button', { name: 'Copy invite', exact: true }).click();
  const invite = new URL(await page.getByLabel('Invite link').inputValue());
  expect(invite.searchParams.get('room')).toBe('ROOM_B');
  expect(invite.searchParams.get('s')).toBe('fixture-secret-b');
  expect(errors).toEqual([]);
});

test('host recovery reports provider failure and permits a retry', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lastHostedRoom', JSON.stringify({
    roomId: 'ROOM_A', hostName: 'Host', roomSecret: 'fixture-recovery-secret',
  })));
  const errors = await openApp(page);
  await page.getByLabel('Your name').fill('Host');
  await page.evaluate(() => window.seedTestHostRecovery());
  await page.evaluate(() => window.rejectNextTestRoomRead());
  await page.getByRole('button', { name: 'Rejoin as Host', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Could not rejoin the room. Try again.');
  await expect(page.getByLabel('Your name')).toHaveValue('Host');
  await page.getByRole('button', { name: 'Rejoin as Host', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friday movie');
  await expect(page.locator('.room-role')).toHaveText('Host');
  expect(errors).toEqual([]);
});

test('browser storage failure does not block creation or in-page host recovery', async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        if (args[0] === 'lastHostedRoom') throw new DOMException('Storage unavailable', 'SecurityError');
        return original.apply(this, args);
      };
    }
  });
  const errors = await openApp(page);
  await page.getByLabel('Your name').fill('Guest');
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Guest's Room");
  await page.getByRole('button', { name: 'Leave room', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rejoin as Host', exact: true })).toBeVisible();
  await page.getByLabel('Your name').fill('Guest');
  await page.getByRole('button', { name: 'Rejoin as Host', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Guest's Room");
  expect(errors).toEqual([]);
});

test('room creation fails closed when secure invite generation is unavailable', async ({ page }) => {
  const errors = await openApp(page);
  await page.getByLabel('Your name').fill('Host');
  await page.evaluate(() => Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined }));
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Your browser cannot create a secure invite. Use a current browser on HTTPS.');
  await expect(page.getByLabel('Your name')).toBeVisible();
  expect(errors).toEqual([]);
});
