import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
const database = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
async function openRoom(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (['error','warning'].includes(m.type())) errors.push(m.text()); });
  page.on('dialog', async (d) => { errors.push('Unexpected blocking dialog'); await d.dismiss(); });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5175') return route.continue();
    let body;
    if (url.pathname.endsWith('/firebase-database.js')) body = database;
    else if (url.pathname.endsWith('/firebase-auth.js')) body = auth;
    else if (url.pathname.endsWith('/firebase-app.js')) body = 'export const initializeApp=()=>({});';
    else if (url.hostname === 'www.youtube.com') body = 'window.YT={Player:function(){}};window.onYouTubeIframeAPIReady?.();';
    else if (url.hostname === 'accounts.google.com') body = 'window.google={accounts:{oauth2:{}}};';
    else throw new Error(`Unexpected external request to ${url.origin}`);
    return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  });
  await page.addInitScript(() => {
    window.testMicCalls = 0; window.testMicStops = 0; window.testMicMode = 'deny'; window.testAudioMode = 'play';
    window.AudioContext = undefined; window.webkitAudioContext = undefined;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: (options) => {
      window.testMicCalls++; window.testMicOptions = options;
      if (window.testMicMode === 'deny') return Promise.reject(new DOMException('private microphone detail', 'NotAllowedError'));
      const track = { enabled: true, stop: () => { window.testMicStops++; } };
      window.testMicTrack = track;
      const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
      if (window.testMicMode === 'hold') return new Promise((resolve) => { window.releaseTestMicrophone = () => resolve(stream); });
      return Promise.resolve(stream);
    } } });
    window.Audio = class { play() { return window.testAudioMode === 'blocked' ? Promise.reject(new DOMException('blocked', 'NotAllowedError')) : Promise.resolve(); } pause() {} };
    window.RTCPeerConnection = class {
      constructor() { this.connectionState = 'new'; }
      close() { this.connectionState = 'closed'; } addTrack() {}
      async createOffer() { return { type: 'offer', sdp: 'fixture-offer' }; }
      async createAnswer() { return { type: 'answer', sdp: 'fixture-answer' }; }
      async setLocalDescription(value) { this.localDescription = value; }
      async setRemoteDescription(value) {
        this.remoteDescription = value;
        if (value.type === 'answer') { this.connectionState = 'connected'; this.onconnectionstatechange?.(); await this.ontrack?.({ streams: [{}] }); }
      }
      async addIceCandidate() {}
    };
  });
  await page.goto('/?room=ROOM_A&s=fixture-secret');
  await expect(page).toHaveTitle('Watch Party | Watch together');
  await page.getByLabel('Your name').fill('Guest');
  await page.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friday movie');
  await page.evaluate(() => window.setTestConnection(true));
  await expect(page.getByRole('button', { name: 'Join voice', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.testMicCalls)).toBe(0);
  return errors;
}
test('microphone permission is explicit, denial is inline, and leaving stops late capture', async ({ page }, info) => {
  const errors = await openRoom(page);
  const before = await page.evaluate(() => window.testPlaybackState('ROOM_A'));
  await page.getByRole('button', { name: 'Join voice', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('permission');
  await expect(page.getByText('private microphone detail')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('microphone-permission.png'), fullPage: true });
  await page.evaluate(() => { window.testMicMode = 'hold'; });
  await page.getByRole('button', { name: 'Join voice', exact: true }).evaluate((button) => { button.click(); button.click(); });
  await expect(page.getByRole('button', { name: 'Joining voice...', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.testMicCalls)).toBe(2);
  await page.getByRole('button', { name: 'Leave room', exact: true }).click();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await page.evaluate(() => window.releaseTestMicrophone());
  await expect.poll(() => page.evaluate(() => window.testMicStops)).toBe(1);
  expect((await page.evaluate(() => window.testVoiceState())).Guest).toBeUndefined();
  expect(await page.evaluate(() => window.testPlaybackState('ROOM_A'))).toEqual(before);
  expect(errors).toEqual([]);
});
test('voice mute, remote autoplay recovery and speaking feedback leave playback untouched', async ({ page }, info) => {
  const errors = await openRoom(page);
  const before = await page.evaluate(() => window.testPlaybackState('ROOM_A'));
  await page.evaluate(() => { window.testMicMode = 'allow'; window.testAudioMode = 'blocked'; window.seedTestVoice(); });
  await page.getByRole('button', { name: 'Join voice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.answerTestVoice())).toBe(true);
  await expect(page.getByRole('button', { name: 'Enable voice audio', exact: true })).toBeVisible();
  await page.evaluate(() => { window.testAudioMode = 'play'; });
  await page.getByRole('button', { name: 'Enable voice audio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enable voice audio', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
  expect(await page.evaluate(() => window.testMicTrack.enabled)).toBe(false);
  await page.getByRole('button', { name: 'Unmute microphone', exact: true }).click();
  expect(await page.evaluate(() => window.testMicTrack.enabled)).toBe(true);
  await page.evaluate(() => window.seedTestVoice(true));
  await expect(page.getByRole('status', { name: 'Host speaking' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('voice-connected.png'), fullPage: true });
  expect(await page.evaluate(() => window.testPlaybackState('ROOM_A'))).toEqual(before);
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Join voice', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.testMicStops)).toBe(1);
  expect(errors).toEqual([]);
});
test('voice stays opted in across a signaling disconnect and reconnects without another capture request', async ({ page }) => {
  const errors = await openRoom(page);
  await page.evaluate(() => { window.testMicMode = 'allow'; });
  await page.getByRole('button', { name: 'Join voice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeVisible();
  await page.evaluate(() => window.setTestConnection(false));
  await expect(page.getByRole('button', { name: 'Leave voice', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Voice chat status' })).toContainText('Reconnecting');
  expect(await page.evaluate(() => window.testMicStops)).toBe(0);
  await page.evaluate(() => window.setTestConnection(true));
  await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.testMicCalls)).toBe(1);
  await page.getByRole('button', { name: 'Leave room', exact: true }).click();
  expect(await page.evaluate(() => window.testMicStops)).toBe(1);
  expect(errors).toEqual([]);
});
