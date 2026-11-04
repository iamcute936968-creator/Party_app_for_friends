import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { expect, test } from '@playwright/test';

// Real app/File/fetch/DOM; only provider boundaries are fixtures. No live credentials.
const databaseFixture = await readFile(new URL('./firebase-fixture.js', import.meta.url), 'utf8');
const authFixture = await readFile(new URL('./firebase-auth-fixture.js', import.meta.url), 'utf8');
const APP = 'http://127.0.0.1:5175';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN = 'fixture-upload-token';
const ownerHash = createHash('sha256').update('fixture-user').digest('hex');
const SESSION = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fixture-private-upload';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Authorization,Content-Type,Content-Range,X-Upload-Content-Length,X-Upload-Content-Type',
  'access-control-allow-methods': 'GET,POST,PUT,OPTIONS', 'access-control-expose-headers': 'Location,Range' };

async function openLibrary(page, { enabled = true, stallFirstList = false } = {}) {
  const errors = [], calls = [];
  let listCalls = 0, releaseList;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.route('**/*', async route => {
    const req = route.request(), target = new URL(req.url());
    if (target.origin === APP && target.pathname === '/__test/media-proxy/api/uploads/config')
      return route.fulfill({ json: enabled ? { enabled: true, readerEmail: 'reader@fixture-project.iam.gserviceaccount.com' } : { enabled: false } });
    if (target.origin === APP) return route.continue();
    let body;
    if (target.pathname.endsWith('/firebase-database.js')) body = databaseFixture;
    else if (target.pathname.endsWith('/firebase-auth.js')) body = authFixture;
    else if (target.pathname.endsWith('/firebase-app.js')) body = 'export const initializeApp = () => ({});';
    else if (target.hostname === 'www.youtube.com') body = 'window.YT={Player:function(){}};window.onYouTubeIframeAPIReady?.();';
    else if (target.hostname === 'accounts.google.com') body = `window.google={accounts:{oauth2:{initTokenClient(options){
      if(options.scope!==${JSON.stringify(SCOPE)}||options.include_granted_scopes!==false)throw new Error('Unexpected Drive scope');
      return {requestAccessToken(){window.uploadConsentCount=(window.uploadConsentCount||0)+1;queueMicrotask(()=>options.callback({access_token:${JSON.stringify(TOKEN)},scope:${JSON.stringify(SCOPE)},expires_in:3600}));}};
    }}}};`;
    else if (target.hostname === 'www.googleapis.com') {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      expect(req.headers().authorization).toBe(`Bearer ${TOKEN}`);
      calls.push({ pathname: target.pathname, method: req.method(), body: req.postData() });
      const respond = value => route.fulfill({ json: value, headers: cors });
      if (target.pathname === '/drive/v3/files' && req.method() === 'GET') {
        expect(target.searchParams.get('q')).toContain(ownerHash);
        if (++listCalls === 1 && stallFirstList) await new Promise(resolve => { releaseList = resolve; });
        return respond({ files: [] });
      }
      if (target.pathname === '/drive/v3/about' && req.method() === 'GET') return respond({ storageQuota: { usage: '0', limit: '1000000' } });
      if (target.pathname === '/upload/drive/v3/files' && req.method() === 'POST') {
        expect(target.searchParams.get('uploadType')).toBe('resumable');
        return route.fulfill({ json: {}, headers: { ...cors, Location: SESSION } });
      }
      if (target.href === SESSION && req.method() === 'PUT') {
        expect(req.headers()['content-range']).toBe('bytes 0-3/4');
        return respond({ id: 'uploaded_file', size: '4', mimeType: 'video/mp4' });
      }
      errors.push(`Unexpected Drive request: ${req.method()} ${target.pathname}`);
      return route.abort();
    } else if (target.hostname === 'lh3.googleusercontent.com') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>' });
    else { errors.push(`Unexpected external request: ${target.origin}`); return route.abort(); }
    return route.fulfill({ contentType: 'text/javascript', headers: cors, body });
  });
  await page.goto('/account');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Private video uploads' });
  await expect(panel).toBeVisible();
  return { errors, calls, panel, releaseList: () => releaseList?.() };
}

test('private upload uses per-file consent, never shares automatically and renders filenames as text', async ({ page }, testInfo) => {
  const { panel, calls, errors } = await openLibrary(page);
  await panel.getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await expect(panel.getByText('No uploaded videos yet.', { exact: true })).toBeVisible();
  const filename = '<img src=x onerror=alert(1)>.mp4';
  await panel.getByLabel('Video file', { exact: true }).setInputFiles({ name: filename, mimeType: 'video/mp4', buffer: Buffer.from([1, 2, 3, 4]) });
  await panel.getByRole('button', { name: 'Upload privately', exact: true }).click();
  await expect(panel.getByText(/Uploaded to your private Google Drive/)).toBeVisible();
  await expect(panel.getByText(filename, { exact: true })).toBeVisible();
  await expect(panel.locator('img')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Share with this room', exact: true })).toHaveCount(0);
  expect(calls.map(call => `${call.method} ${call.pathname}`)).toEqual([
    'GET /drive/v3/files', 'GET /drive/v3/about', 'POST /upload/drive/v3/files', 'PUT /upload/drive/v3/files',
  ]);
  const metadata = JSON.parse(calls.find(call => call.method === 'POST').body);
  expect(metadata).toEqual({ name: filename, mimeType: 'video/mp4', properties: {
    watchPartyVersion: '1', watchPartyOwnerHash: ownerHash, watchPartyRoom: '',
  } });
  expect(await page.evaluate(() => window.uploadConsentCount)).toBe(1);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain(TOKEN);
  expect(storage).not.toContain('fixture-private-upload');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('private-upload-library.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('initial connection can be cancelled before a stalled file list resolves', async ({ page }) => {
  const state = await openLibrary(page, { stallFirstList: true });
  const connect = state.panel.getByRole('button', { name: 'Connect Google Drive', exact: true });
  await connect.click();
  await expect.poll(() => state.calls.filter(call => call.pathname === '/drive/v3/files').length).toBe(1);
  await expect(state.panel.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await state.panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(connect).toBeEnabled();
  state.releaseList();
  await expect(state.panel.getByLabel('Video file', { exact: true })).toHaveCount(0);
  await connect.click();
  await expect(state.panel.getByText('No uploaded videos yet.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.uploadConsentCount)).toBe(1);
  expect(state.errors).toEqual([]);
});

test('disabled upload service has a clear status and never opens Drive consent', async ({ page }) => {
  const { panel, calls, errors } = await openLibrary(page, { enabled: false });
  await expect(panel.getByRole('status')).toHaveText('Uploads are unavailable right now. Please try again later.');
  await expect(panel.getByRole('button', { name: 'Connect Google Drive', exact: true })).toHaveCount(0);
  expect(calls).toEqual([]);
  expect(await page.evaluate(() => window.uploadConsentCount || 0)).toBe(0);
  expect(errors).toEqual([]);
});
