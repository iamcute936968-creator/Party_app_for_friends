// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { listUploadedVideos, shareUploadedVideo, uploadDriveVideo } from '../../src/uploads/driveUpload';

const CHUNK = 1024 * 1024;
const SESSION = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test-session';
const ownerUid = 'owner-uid';
const ownerHash = createHash('sha256').update(ownerUid).digest('hex');
const readerEmail = 'reader@watch-party.iam.gserviceaccount.com';
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const incomplete = range => new Response(null, { status: 308, headers: range ? { Range: range } : {} });
const video = (size = 5, type = 'video/mp4', name = 'Our movie.mp4') => new File([new Uint8Array(size)], name, { type });
const quota = () => json({ storageQuota: { limit: String(10 * CHUNK), usage: '0' } });
const started = (url = SESSION) => new Response(null, { status: 200, headers: { Location: url } });
const completed = (size = 5, extra = {}) => json({ id: 'file_123', name: 'Our movie.mp4', size: String(size), mimeType: 'video/mp4', ...extra });
const upload = (fetchFn, extra = {}) => uploadDriveVideo({ file: video(), ownerUid, token: 'secret-access-token', fetchFn, ...extra });
const owned = (extra = {}) => ({ id: 'file_123', name: 'Our movie.mp4', mimeType: 'video/mp4', size: '5', ownedByMe: true,
  properties: { watchPartyVersion: '1', watchPartyOwnerHash: ownerHash, watchPartyRoom: '' }, permissions: [], ...extra });
const share = (fetchFn, extra = {}) => shareUploadedVideo({ id: 'file_123', ownerUid, roomId: 'room_123', readerEmail, token: 'secret-access-token', fetchFn, ...extra });
const queued = (...responses) => {
  const fetchFn = vi.fn();
  responses.forEach(response => response instanceof Error ? fetchFn.mockRejectedValueOnce(response) : fetchFn.mockResolvedValueOnce(response));
  return fetchFn;
};

describe('uploaded video listing', () => {
  it('lists only owned app uploads for this Firebase account using the per-file grant', async () => {
    const fetchFn = queued(json({ files: [owned(), owned({ id: 'other', ownedByMe: false }),
      owned({ id: 'foreign', properties: { watchPartyOwnerHash: 'f'.repeat(64), watchPartyVersion: '1' } }),
      owned({ id: 'bad/ID' }), owned({ mimeType: 'text/html' })] }));
    expect(await listUploadedVideos({ ownerUid, token: 'secret-access-token', fetchFn })).toEqual([
      { source: 'drive', id: 'file_123', title: 'Our movie.mp4', size: 5, mimeType: 'video/mp4' },
    ]);
    const [url, options] = fetchFn.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(`${'https://www.googleapis.com/drive/v3'}/files`);
    expect(parsed.searchParams.get('pageSize')).toBe('50');
    expect(parsed.searchParams.get('q')).toContain(ownerHash);
    expect(options).toMatchObject({ redirect: 'error', credentials: 'omit', headers: { Authorization: 'Bearer secret-access-token' } });
  });
  it('bounds results and rejects malformed provider responses without leaking credentials', async () => {
    const fetchFn = queued(json({ files: 'secret-access-token' }));
    await expect(listUploadedVideos({ ownerUid, token: 'secret-access-token', fetchFn })).rejects.toThrow('Your uploaded videos could not be loaded. Please try again.');
    await expect(listUploadedVideos({ ownerUid: '', token: 'x', fetchFn })).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('private Drive upload', () => {
  it.each([
    { file: video(0) }, { file: video(1, 'text/html') }, { file: { size: 2 * 1024 ** 3 + 1, type: 'video/mp4', slice() {} } },
    { ownerUid: '' }, { ownerUid: 'bad/uid' }, { token: '' }, { token: 'bad\r\ntoken' },
  ])('rejects invalid upload input before any provider call: %j', async extra => {
    const fetchFn = vi.fn();
    await expect(upload(fetchFn, extra)).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('checks quota and creates a private app-marked upload; returns only canonical metadata', async () => {
    const fetchFn = queued(quota(), started(), completed());
    const progress = vi.fn();
    expect(await upload(fetchFn, { onProgress: progress })).toEqual({ source: 'drive', id: 'file_123', title: 'Our movie.mp4', size: 5, mimeType: 'video/mp4' });
    expect(fetchFn.mock.calls[0][0]).toBe('https://www.googleapis.com/drive/v3/about?fields=storageQuota');
    const [url, options] = fetchFn.mock.calls[1];
    expect(url).toBe('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,properties');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', headers: {
      Authorization: 'Bearer secret-access-token', 'X-Upload-Content-Length': '5', 'X-Upload-Content-Type': 'video/mp4',
    } });
    expect(JSON.parse(options.body)).toEqual({ name: 'Our movie.mp4', mimeType: 'video/mp4', properties: {
      watchPartyVersion: '1', watchPartyOwnerHash: ownerHash, watchPartyRoom: '',
    } });
    expect(JSON.stringify(fetchFn.mock.calls.map(([, request]) => request.body)).replaceAll('secret-access-token', '')).not.toContain(ownerUid);
    expect(fetchFn.mock.calls.every(([, request]) => request.redirect === 'error' && request.credentials === 'omit')).toBe(true);
    expect(progress.mock.calls.map(([value]) => value)).toEqual([0, 100]);
  });

  it('bounds the name, accepts WebM and an unlimited Drive quota', async () => {
    const fetchFn = queued(json({ storageQuota: { usage: '123' } }), started(), completed(5, { mimeType: 'video/webm' }));
    const result = await upload(fetchFn, { file: video(5, 'video/webm', 'x'.repeat(150) + '.webm') });
    expect(result.title).toHaveLength(120);
    expect(JSON.parse(fetchFn.mock.calls[1][1].body).name).toHaveLength(120);
    expect(result.mimeType).toBe('video/webm');
  });

  it.each([
    { limit: '9', usage: '5' }, { limit: 'bad', usage: '0' }, { limit: '100' }, { limit: '10', usage: '-1' }, null,
  ])('stops before upload when quota is insufficient or malformed: %j', async storageQuota => {
    const fetchFn = queued(json({ storageQuota }));
    await expect(upload(fetchFn)).rejects.toThrow(/storage|quota/i);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each([
    'https://evil.test/upload?upload_id=x', 'http://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://www.googleapis.com.evil.test/upload/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://user:pass@www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x#fragment',
    'https://www.googleapis.com/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
  ])('rejects an unsafe session Location before sending bytes: %s', async location => {
    const fetchFn = queued(quota(), started(location));
    await expect(upload(fetchFn)).rejects.toThrow(/upload/i);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('sends bounded chunks and advances only by server-acknowledged bytes', async () => {
    const size = 2 * CHUNK + 5;
    const fetchFn = queued(quota(), started(), incomplete(`bytes=0-${CHUNK - 1}`), incomplete(`bytes=0-${2 * CHUNK - 1}`), completed(size));
    const onProgress = vi.fn();
    await upload(fetchFn, { file: video(size), onProgress });
    const chunks = fetchFn.mock.calls.slice(2).map(([, request]) => request);
    expect(chunks.map(request => request.headers['Content-Range'])).toEqual([
      `bytes 0-${CHUNK - 1}/${size}`, `bytes ${CHUNK}-${2 * CHUNK - 1}/${size}`, `bytes ${2 * CHUNK}-${size - 1}/${size}`,
    ]);
    expect(chunks.map(request => request.body.size)).toEqual([CHUNK, CHUNK, 5]);
    expect(onProgress.mock.calls.map(([value]) => value)).toEqual([0, 49, 99, 100]);
  });

  it('probes an interrupted upload then resumes at the acknowledged byte without restarting', async () => {
    const size = CHUNK + 5;
    const fetchFn = queued(quota(), started(), new Error(`private ${SESSION}`), incomplete('bytes=0-262143'), incomplete(`bytes=0-${CHUNK + 262143}`), completed(size));
    // The probe may acknowledge only bytes already sent; this larger response must be rejected.
    await expect(upload(fetchFn, { file: video(size) })).rejects.toThrow(/upload/i);
    expect(fetchFn.mock.calls[3][1]).toMatchObject({ method: 'PUT', headers: { 'Content-Range': `bytes */${size}` } });
    expect(fetchFn.mock.calls[4][1].headers['Content-Range']).toBe(`bytes 262144-${size - 1}/${size}`);
    expect(fetchFn.mock.calls.filter(([, request]) => request.method === 'POST')).toHaveLength(1);
  });

  it('recovers after transient failures and accepts completion from a status probe', async () => {
    const fetchFn = queued(quota(), started(), new Error('private network detail'), completed());
    await expect(upload(fetchFn)).resolves.toMatchObject({ id: 'file_123' });
    expect(fetchFn.mock.calls[3][1].headers['Content-Range']).toBe('bytes */5');
    const retry = queued(quota(), started(), new Response(null, { status: 503 }), incomplete(), completed());
    await expect(upload(retry)).resolves.toMatchObject({ id: 'file_123' });
    expect(retry.mock.calls[4][1].headers['Content-Range']).toBe('bytes 0-4/5');
  });

  it.each(['bytes=1-3', 'bytes=0-9999', 'bytes=0--1', 'bytes=0-1,4-5', 'private'])('rejects malformed or impossible acknowledgements: %s', async range => {
    const fetchFn = queued(quota(), started(), incomplete(range));
    await expect(upload(fetchFn)).rejects.toThrow(/upload/i);
  });

  it('bounds retry attempts when the server never acknowledges progress', async () => {
    const fetchFn = queued(quota(), started());
    fetchFn.mockResolvedValue(incomplete());
    await expect(upload(fetchFn)).rejects.toThrow(/upload/i);
    expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it.each([{ id: '../private' }, { size: '99' }, { mimeType: 'text/html' }])('rejects invalid completion metadata: %j', async extra => {
    const fetchFn = queued(quota(), started(), completed(5, extra));
    await expect(upload(fetchFn)).rejects.toThrow(/upload/i);
  });

  it('rejects premature completion before all bytes have been sent', async () => {
    const fetchFn = queued(quota(), started(), completed(CHUNK + 5));
    await expect(upload(fetchFn, { file: video(CHUNK + 5) })).rejects.toThrow(/upload/i);
  });

  it('aborts before or during a request and suppresses stale progress', async () => {
    const signal = AbortSignal.abort();
    const never = vi.fn();
    await expect(upload(never, { signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(never).not.toHaveBeenCalled();
    const controller = new AbortController();
    const onProgress = vi.fn();
    const fetchFn = queued(quota(), started());
    fetchFn.mockImplementationOnce(async () => { controller.abort(); return completed(); });
    await expect(upload(fetchFn, { signal: controller.signal, onProgress })).rejects.toMatchObject({ name: 'AbortError' });
    expect(onProgress).not.toHaveBeenCalledWith(100);
  });

  it('masks provider/network errors without exposing tokens, sessions, or causes', async () => {
    const fetchFn = queued(new Error(`secret-access-token ${SESSION}`));
    const error = await upload(fetchFn).catch(value => value);
    expect(error.message).not.toMatch(/secret-access-token|upload_id|test-session/);
    expect(error.cause).toBeUndefined();
  });
});

describe('explicit room sharing', () => {
  it.each([
    { id: '../file' }, { ownerUid: 'bad/uid' }, { roomId: 'bad/room' }, { roomId: 'room\n' },
    { readerEmail: 'anyone' }, { readerEmail: 'user@example.com' }, { readerEmail: 'reader@evil-gserviceaccount.com' }, { token: '' },
  ])('rejects invalid sharing input before any provider call: %j', async extra => {
    const fetchFn = vi.fn();
    await expect(share(fetchFn, extra)).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    { ownedByMe: false }, { id: 'another_file' }, { properties: {} },
    { properties: { watchPartyVersion: '1', watchPartyOwnerHash: 'another-owner' } },
  ])('requires Google ownership and this app/account upload marker: %j', async extra => {
    const fetchFn = queued(json(owned(extra)));
    await expect(share(fetchFn)).rejects.toThrow(/shar|owner|upload/i);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('binds exactly one room before granting only the service-account user reader', async () => {
    const fetchFn = queued(json(owned()), json({ id: 'file_123' }), json({ id: 'permission_123' }));
    expect(await share(fetchFn)).toEqual({ source: 'drive', id: 'file_123' });
    expect(fetchFn.mock.calls[0][0]).toContain('https://www.googleapis.com/drive/v3/files/file_123?fields=');
    expect(fetchFn.mock.calls[1][1]).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(fetchFn.mock.calls[1][1].body)).toEqual({ properties: { watchPartyRoom: 'room_123' } });
    expect(fetchFn.mock.calls[2][0]).toBe('https://www.googleapis.com/drive/v3/files/file_123/permissions?sendNotificationEmail=false&fields=id');
    expect(JSON.parse(fetchFn.mock.calls[2][1].body)).toEqual({ type: 'user', role: 'reader', emailAddress: readerEmail });
    expect(JSON.stringify(fetchFn.mock.calls)).not.toContain('anyone');
  });

  it('reuses an existing exact service-account reader permission and replaces the old room binding', async () => {
    const fetchFn = queued(json(owned({ properties: { watchPartyVersion: '1', watchPartyOwnerHash: ownerHash, watchPartyRoom: 'old_room' }, permissions: [
      { id: 'sa', type: 'user', role: 'reader', emailAddress: readerEmail.toUpperCase() },
    ] })), json({ id: 'file_123' }));
    await expect(share(fetchFn)).resolves.toMatchObject({ id: 'file_123' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchFn.mock.calls[1][1].body).properties).toEqual({ watchPartyRoom: 'room_123' });
  });

  it('never grants permission when room binding fails and hides provider errors', async () => {
    const fetchFn = queued(json(owned()), json({ error: { message: 'private token detail' } }, 403));
    const error = await share(fetchFn).catch(value => value);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(error.message).not.toMatch(/private|token|detail/);
    expect(error.cause).toBeUndefined();
  });

  it('honors cancellation before granting permission after a stale binding response', async () => {
    const controller = new AbortController();
    const fetchFn = queued(json(owned()));
    fetchFn.mockImplementationOnce(async () => { controller.abort(); return json({ id: 'file_123' }); });
    await expect(share(fetchFn, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
