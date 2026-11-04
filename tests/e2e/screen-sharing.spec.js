import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const fixture = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const firebaseAuthFixture = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
async function openRoom(page, activeShare = false) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
  page.on('dialog', async (d) => { errors.push('Unexpected blocking dialog'); await d.dismiss(); });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5175') return route.continue();
    let body;
    if (url.pathname.endsWith('/firebase-database.js')) body = fixture;
    else if (url.pathname.endsWith('/firebase-auth.js')) body = firebaseAuthFixture;
    else if (url.pathname.endsWith('/firebase-app.js')) body = 'export const initializeApp=()=>({});';
    else if (url.hostname === 'www.youtube.com') body = 'window.YT={Player:function(){}};window.onYouTubeIframeAPIReady?.();';
    else if (url.hostname === 'accounts.google.com') body = 'window.google={accounts:{oauth2:{}}};';
    else throw new Error(`Unexpected external request to ${url.origin}`);
    return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
  await page.addInitScript(() => {
    window.testCaptureCalls = 0; window.testStoppedTracks = 0; window.testCaptureMode = 'deny';
    const track = { stop: () => { window.testStoppedTracks++; }, applyConstraints: async () => {} };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia: () => {
      window.testCaptureCalls++;
      if (window.testCaptureMode === 'deny') return Promise.reject(new DOMException('private capture detail', 'NotAllowedError'));
      if (window.testCaptureMode === 'hold') return new Promise((resolve) => { window.releaseTestCapture = () => resolve(stream); });
      return Promise.resolve(stream);
    } } });
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true,
      get() { return this.testStream || null; }, set(value) { this.testStream = value; },
    });
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    window.RTCPeerConnection = class {
      constructor() { this.connectionState = 'new'; window.testLastScreenPeer = this; }
      close() { this.connectionState = 'closed'; }
      addTrack() {}
      async createOffer() { return { type: 'offer', sdp: 'fixture-offer' }; }
      async createAnswer() { return { type: 'answer', sdp: 'fixture-answer' }; }
      async setRemoteDescription(value) { this.remoteDescription = value; }
      async setLocalDescription(value) {
        this.localDescription = value;
        if (value.type === 'answer') queueMicrotask(() => { this.connectionState = 'connected'; this.onconnectionstatechange?.(); void this.ontrack?.({ streams: [stream] }); });
      }
      async addIceCandidate() {}
    };
    window.failTestScreenPeer = () => { const peer = window.testLastScreenPeer; peer.connectionState = 'failed'; peer.onconnectionstatechange(); };
  });
  await page.goto('/?room=ROOM_A');
  await expect(page).toHaveTitle('Watch Party | Watch together');
  await page.getByLabel('Your name').fill('Guest');
  if (activeShare) await page.evaluate(() => window.seedTestScreenShare());
  else await page.evaluate(() => window.seedTestDriveVideo('ROOM_A', 'abcdefghijk', 'youtube'));
  await page.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friday movie');
  await page.evaluate(() => window.setTestConnection(true));
  return errors;
}
test('capture denial preserves playback, pending duplicate capture is blocked, and the owner can stop', async ({ page }, info) => {
  const errors = await openRoom(page);
  const before = await page.evaluate(() => window.testPlaybackState('ROOM_A'));
  await page.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('permission');
  await expect(page.getByText('private capture detail')).toHaveCount(0);
  expect(await page.evaluate(() => window.testPlaybackState('ROOM_A'))).toEqual(before);
  await page.screenshot({ path: info.outputPath('screen-permission-error.png'), fullPage: true });
  await page.evaluate(() => { window.testCaptureMode = 'hold'; });
  await page.getByRole('button', { name: 'Share screen', exact: true }).evaluate((b) => { b.click(); b.click(); });
  await expect(page.getByRole('button', { name: 'Starting share...', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.testCaptureCalls)).toBe(2);
  await page.evaluate(() => window.releaseTestCapture());
  await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.testShareState())).toMatchObject({ isSharing: true, shareHost: 'Guest' });
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Share screen', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.testStoppedTracks)).toBe(1);
  expect((await page.evaluate(() => window.testShareState())).isSharing).toBe(false);
  expect(errors).toEqual([]);
});
test('late viewers can reconnect and leave without stopping another person share', async ({ page }, info) => {
  const errors = await openRoom(page, true);
  const before = await page.evaluate(() => window.testShareState());
  await page.evaluate(() => window.deliverTestScreenOffer());
  await expect(page.getByRole('status', { name: 'Screen sharing status' })).toHaveText('Connected to screen share.');
  await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.failTestScreenPeer());
  await expect(page.getByRole('button', { name: 'Reconnect screen share', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Reconnect screen share', exact: true }).click();
  await page.evaluate(() => window.deliverTestScreenOffer());
  await expect(page.getByRole('status', { name: 'Screen sharing status' })).toHaveText('Connected to screen share.');
  await page.screenshot({ path: info.outputPath('screen-viewer-reconnected.png'), fullPage: true });
  await page.getByRole('button', { name: 'Leave room', exact: true }).click();
  await expect(page.getByLabel('Your name')).toBeVisible();
  expect(await page.evaluate(() => window.testShareState())).toEqual(before);
  expect(await page.evaluate(() => window.testCaptureCalls)).toBe(0);
  expect(errors).toEqual([]);
});
test('leaving during the browser picker stops late capture without publishing it', async ({ page }) => {
  const errors = await openRoom(page);
  const before = await page.evaluate(() => window.testPlaybackState('ROOM_A'));
  await page.evaluate(() => { window.testCaptureMode = 'hold'; });
  await page.getByRole('button', { name: 'Share screen', exact: true }).click();
  await page.getByRole('button', { name: 'Leave room', exact: true }).click();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await page.evaluate(() => window.releaseTestCapture());
  await expect.poll(() => page.evaluate(() => window.testStoppedTracks)).toBe(1);
  expect(await page.evaluate(() => window.testPlaybackState('ROOM_A'))).toEqual(before);
  expect((await page.evaluate(() => window.testShareState())).isSharing).toBe(false);
  expect(errors).toEqual([]);
});
