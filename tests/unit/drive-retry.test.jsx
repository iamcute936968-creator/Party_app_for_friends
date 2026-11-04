import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDriveStream } from '../../src/hooks/useDriveStream';
import { useDriveVideo } from '../../src/hooks/useDriveVideo';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const params = { roomId: 'ROOM_A', roomSecret: 'fixture-secret', username: 'Guest' };
const ticket = { ok: true, json: async () => ({ mediaUrl: '/media/movie?t=fixture-ticket', expiresAt: 5000 }) };
const metadata = (name) => ({ ok: true, json: async () => ({ name, mimeType: 'video/mp4', size: '3' }) });
const bytes = () => ({ ok: true, headers: new Headers({ 'content-length': '3' }), body: {
  getReader: () => ({ read: vi.fn().mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) }).mockResolvedValue({ done: true }) }),
} });
function mockObjectUrls() {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:fixture-video');
    static revokeObjectURL = vi.fn();
  });
}

it('can retry a failed ticket for the same file without room writes', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Temporary network failure')).mockResolvedValueOnce(ticket);
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() => useDriveStream({ proxyUrl: 'https://proxy.example' }));
  await act(async () => result.current.loadDriveStream('movie', params));
  expect(result.current.error).toBeTruthy();
  await act(async () => result.current.loadDriveStream('movie', params));
  expect(result.current.error).toBeNull();
  expect(result.current.mediaUrl).toBe('https://proxy.example/media/movie?t=fixture-ticket');
  expect(result.current.loading).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ ...params, fileId: 'movie' });
});

it('attaches the current Firebase ID token and fails closed if authentication is unavailable', async () => {
  const fetch = vi.fn().mockResolvedValue(ticket);
  vi.stubGlobal('fetch', fetch);
  const getIdToken = vi.fn().mockResolvedValue('fixture-token');
  const { result, rerender } = renderHook(({ tokenProvider }) => useDriveStream({ proxyUrl: 'https://proxy.example', getIdToken: tokenProvider }), { initialProps: { tokenProvider: getIdToken } });
  await act(async () => result.current.loadDriveStream('movie', params));
  expect(JSON.parse(fetch.mock.calls[0][1].body).firebaseIdToken).toBe('fixture-token');
  rerender({ tokenProvider: async () => { throw new Error('private authentication detail'); } });
  await act(async () => result.current.loadDriveStream('movie', params));
  expect(fetch).toHaveBeenCalledOnce();
  expect(result.current.error).not.toContain('private');
});

it('does not clear current authorization when an old ticket error body finishes late', async () => {
  let finishBody;
  const unauthorized = vi.fn();
  const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 401, json: () => new Promise((resolve) => { finishBody = resolve; }) }).mockResolvedValueOnce(ticket);
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() => useDriveStream({ proxyUrl: 'https://proxy.example', onUnauthorized: unauthorized }));
  let old;
  await act(async () => { old = result.current.loadDriveStream('old-file', params); });
  await act(async () => result.current.loadDriveStream('movie', params));
  await act(async () => { finishBody({ error: 'old authorization error' }); await old; });
  expect(unauthorized).not.toHaveBeenCalled();
  expect(result.current.mediaUrl).toContain('/media/movie?');
  expect(result.current.error).toBeNull();
});

it('cancels a revoked ticket and ignores its late authorization failure', async () => {
  let finish;
  const unauthorized = vi.fn();
  const fetch = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() => useDriveStream({ proxyUrl: 'https://proxy.example', onUnauthorized: unauthorized }));
  let pending;
  act(() => { pending = result.current.loadDriveStream('movie', params); });
  act(() => result.current.revokeStream());
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { finish({ ok: false, status: 403, json: async () => ({ error: 'old room' }) }); await pending; });
  expect(unauthorized).not.toHaveBeenCalled();
  expect(result.current.mediaUrl).toBeNull();
  expect(result.current.error).toBeNull();
});

it('cancels a pending ticket on unmount, including StrictMode cleanup', async () => {
  let finish;
  const unauthorized = vi.fn();
  const fetch = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal('fetch', fetch);
  const { result, unmount } = renderHook(() => useDriveStream({ proxyUrl: 'https://proxy.example', onUnauthorized: unauthorized }), { reactStrictMode: true });
  let pending;
  act(() => { pending = result.current.loadDriveStream('movie', params); });
  unmount();
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { finish({ ok: false, status: 401, json: async () => ({}) }); await pending; });
  expect(unauthorized).not.toHaveBeenCalled();
});

it('can retry a failed Drive download for the same file and release its object URL', async () => {
  mockObjectUrls();
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Temporary network failure')).mockResolvedValueOnce(metadata('Movie')).mockResolvedValueOnce(bytes());
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() => useDriveVideo());
  await act(async () => result.current.loadDriveVideo('movie', 'fixture-access-token'));
  expect(result.current.error).toBeTruthy();
  await act(async () => result.current.loadDriveVideo('movie', 'fixture-access-token'));
  expect(result.current.error).toBeNull();
  expect(result.current.blobUrl).toBe('blob:fixture-video');
  expect(result.current.progress).toBe(100);
  act(() => result.current.revokeBlobUrl());
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fixture-video');
});

it('does not publish old metadata or start an old download after a replacement succeeds', async () => {
  mockObjectUrls();
  let finish;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce(metadata('Current movie')).mockResolvedValueOnce(bytes());
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() => useDriveVideo());
  let old;
  act(() => { old = result.current.loadDriveVideo('old-file', 'fixture-access-token'); });
  await act(async () => result.current.loadDriveVideo('movie', 'fixture-access-token'));
  await act(async () => { finish(metadata('Old movie')); await old; });
  expect(result.current.metadata.name).toBe('Current movie');
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(result.current.blobUrl).toBe('blob:fixture-video');
});

it('ignores a cancelled download request that returns a late 401', async () => {
  let finish;
  const unauthorized = vi.fn();
  const fetch = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() => useDriveVideo(unauthorized));
  let pending;
  act(() => { pending = result.current.loadDriveVideo('movie', 'fixture-access-token'); });
  act(() => result.current.revokeBlobUrl());
  await act(async () => { finish({ ok: false, status: 401 }); await pending; });
  expect(unauthorized).not.toHaveBeenCalled();
  expect(result.current.error).toBeNull();
});

it('aborts a pending download on unmount', async () => {
  const fetch = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetch);
  const { result, unmount } = renderHook(() => useDriveVideo(), { reactStrictMode: true });
  act(() => { void result.current.loadDriveVideo('movie', 'fixture-access-token'); });
  unmount();
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
});

it('revokes a finished download on unmount', async () => {
  mockObjectUrls();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(metadata('Movie')).mockResolvedValueOnce(bytes()));
  const { result, unmount } = renderHook(() => useDriveVideo());
  await act(async () => result.current.loadDriveVideo('movie', 'fixture-access-token'));
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fixture-video');
});
