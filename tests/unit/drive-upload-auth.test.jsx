import { act, cleanup, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDriveUploadAuth } from '../../src/hooks/useDriveUploadAuth';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SCRIPT_ID = '__gis_client_script__';
let configs, requestAccessToken, initTokenClient;
const response = overrides => ({ access_token: 'test-access-token', scope: SCOPE, expires_in: 3600, ...overrides });
function googleReady() {
  initTokenClient = vi.fn(config => { configs.push(config); return { requestAccessToken }; });
  vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient } } });
}
function setup(props = { accountUid: 'account-a', loginHint: 'viewer@example.test' }, options = {}) {
  return renderHook(value => useDriveUploadAuth(value), { initialProps: props, ...options });
}
function begin(result) {
  let pending;
  act(() => { pending = result.current.authorize(); });
  // Attach rejection handling before a later timer/unmount rejects the request.
  return pending.then(token => ({ token }), error => ({ error }));
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client');
  configs = []; requestAccessToken = vi.fn(); googleReady();
});
afterEach(() => {
  cleanup(); document.getElementById(SCRIPT_ID)?.remove();
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers();
});

it('requests only drive.file synchronously from the gesture and reuses a current in-memory token', async () => {
  const local = vi.spyOn(Storage.prototype, 'setItem');
  const { result } = setup();
  expect(result.current.ready).toBe(true);
  const pending = begin(result);
  expect(requestAccessToken).toHaveBeenCalledWith({ prompt: 'consent' });
  expect(configs[0]).toMatchObject({ client_id: 'test-client', scope: SCOPE, include_granted_scopes: false,
    login_hint: 'viewer@example.test' });
  await act(async () => { configs[0].callback(response()); expect(await pending).toEqual({ token: 'test-access-token' }); });
  expect(await result.current.authorize()).toBe('test-access-token');
  expect(initTokenClient).toHaveBeenCalledOnce();
  expect(local).not.toHaveBeenCalled(); local.mockRestore();
});

it('shares an in-flight consent promise without opening another popup', async () => {
  const { result } = setup(); let first, second;
  act(() => { first = result.current.authorize(); second = result.current.authorize(); });
  expect(second).toBe(first); expect(requestAccessToken).toHaveBeenCalledOnce();
  await act(async () => { configs[0].callback(response()); await first; });
});

it('clears cached authorization before expiry and asks again from the next click', async () => {
  const { result } = setup(); const first = begin(result);
  await act(async () => { configs[0].callback(response({ expires_in: 60 })); await first; });
  act(() => { vi.advanceTimersByTime(60_000); });
  const next = begin(result);
  expect(initTokenClient).toHaveBeenCalledTimes(2);
  await act(async () => { configs[1].callback(response()); await next; });
});

it('clearToken discards cached authorization and cancels pending consent', async () => {
  const { result } = setup(); const pending = begin(result);
  act(() => result.current.clearToken());
  expect((await pending).error.message).toMatch(/cancel/i);
  act(() => configs[0].callback(response()));
  const next = begin(result);
  await act(async () => { configs[1].callback(response({ access_token: 'new-token' })); expect(await next).toEqual({ token: 'new-token' }); });
  act(() => result.current.clearToken());
  const third = begin(result);
  expect(initTokenClient).toHaveBeenCalledTimes(3);
  await act(async () => { configs[2].callback(response()); await third; });
});

it('rejects old-account consent and ignores its late callback after account replacement', async () => {
  const { result, rerender } = setup(); const old = begin(result);
  rerender({ accountUid: 'account-b', loginHint: 'other@example.test' });
  expect((await old).error.message).toMatch(/cancel|account/i);
  const current = begin(result);
  act(() => configs[0].callback(response({ access_token: 'stale-token' })));
  await act(async () => { configs[1].callback(response({ access_token: 'current-token' })); expect(await current).toEqual({ token: 'current-token' }); });
  expect(await result.current.authorize()).toBe('current-token');
});

it('never reuses a token after account change or sign-out', async () => {
  const { result, rerender } = setup(); const first = begin(result);
  await act(async () => { configs[0].callback(response()); await first; });
  rerender({ accountUid: 'account-b' });
  const next = begin(result); expect(initTokenClient).toHaveBeenCalledTimes(2);
  rerender({ accountUid: null });
  expect((await next).error).toBeInstanceOf(Error);
  expect(result.current.ready).toBe(false);
  await expect(result.current.authorize()).rejects.toThrow(/sign in|account/i);
});

it.each([false, true])('blocks old-account authorization before replacement effects run (cached: %s)', async cached => {
  let oldAuthorize, oldGap, newGap, checked = false;
  const { result, rerender } = renderHook(({ accountUid }) => {
    const auth = useDriveUploadAuth({ accountUid });
    useLayoutEffect(() => {
      if (accountUid !== 'account-b' || checked) return;
      checked = true;
      oldGap = oldAuthorize().catch(error => error);
      newGap = auth.authorize().catch(error => error);
      if (!cached) configs[0].callback(response({ access_token: 'stale-token' }));
    }, [accountUid, auth]);
    return auth;
  }, { initialProps: { accountUid: 'account-a' } });
  oldAuthorize = result.current.authorize;
  const first = begin(result);
  if (cached) await act(async () => { configs[0].callback(response()); await first; });
  rerender({ accountUid: 'account-b' });
  expect(await oldGap).toBeInstanceOf(Error); expect(await newGap).toBeInstanceOf(Error);
  if (!cached) expect((await first).error).toBeInstanceOf(Error);
  expect(initTokenClient).toHaveBeenCalledOnce();
  const current = begin(result);
  await act(async () => { configs[1].callback(response({ access_token: 'current-token' })); await current; });
  expect(await result.current.authorize()).toBe('current-token');
});

it('rejects pending consent on unmount and ignores late success', async () => {
  const { result, unmount } = setup(); const pending = begin(result);
  unmount();
  expect((await pending).error.message).toMatch(/cancel/i);
  configs[0].callback(response());
  expect(vi.getTimerCount()).toBe(0);
});

it('works under StrictMode and cleans expiry timers on unmount', async () => {
  const { result, unmount } = setup(undefined, { reactStrictMode: true });
  expect(result.current.ready).toBe(true); const pending = begin(result);
  await act(async () => { configs[0].callback(response()); await pending; });
  unmount(); expect(vi.getTimerCount()).toBe(0);
});

it.each([
  { error: 'access_denied', error_description: 'private-provider-detail' },
  { access_token: '' }, { access_token: 'bad token' }, { access_token: 'bad\nvalue' },
  { access_token: 'a'.repeat(8193) }, { scope: 'https://www.googleapis.com/auth/drive.readonly' },
  { scope: null }, { expires_in: 0 }, { expires_in: -1 }, { expires_in: Infinity },
  { expires_in: '3600' }, { expires_in: 86401 }, { expires_in: null },
])('rejects invalid or insufficient consent response %# without leaking provider details', async invalid => {
  const { result } = setup(); const pending = begin(result);
  await act(async () => { configs[0].callback(response(invalid)); await pending; });
  const error = (await pending).error;
  expect(error).toBeInstanceOf(Error); expect(error.message).not.toContain('private-provider-detail');
  expect(result.current.error).toBe(error.message);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['popup_closed', 'popup_failed_to_open', 'unknown'])('handles %s without persisting a token', async type => {
  const { result } = setup(); const pending = begin(result);
  await act(async () => { configs[0].error_callback({ type, message: 'private popup detail' }); await pending; });
  expect((await pending).error.message).not.toContain('private popup detail');
  const next = begin(result);
  await act(async () => { configs[1].callback(response()); await next; });
});

it('bounds consent that never calls back and ignores its eventual response', async () => {
  const { result } = setup(); const pending = begin(result);
  await act(async () => { vi.advanceTimersByTime(120_000); await pending; });
  expect((await pending).error.message).toMatch(/timed out/i);
  act(() => configs[0].callback(response()));
  const next = begin(result);
  expect(initTokenClient).toHaveBeenCalledTimes(2);
  await act(async () => { configs[1].callback(response()); await next; });
});

it('sanitizes initialization and request exceptions', async () => {
  initTokenClient.mockImplementationOnce(() => { throw new Error('private initialization'); });
  const { result } = setup();
  expect((await begin(result)).error.message).not.toContain('private initialization');
  requestAccessToken.mockImplementationOnce(() => { throw new Error('private request'); });
  expect((await begin(result)).error.message).not.toContain('private request');
  expect(vi.getTimerCount()).toBe(0);
});

it('is unavailable without account or configured client and does not inject a script', async () => {
  vi.stubGlobal('google', undefined);
  const { result, rerender } = setup({ accountUid: null });
  expect(result.current.ready).toBe(false); expect(document.getElementById(SCRIPT_ID)).toBeNull();
  await expect(result.current.authorize()).rejects.toThrow(/sign in|account/i);
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', ''); rerender({ accountUid: 'account-a' });
  expect(result.current.ready).toBe(false);
  await expect(result.current.authorize()).rejects.toThrow(/unavailable|configured/i);
  expect(document.getElementById(SCRIPT_ID)).toBeNull();
});

it('loads the shared GIS script once and waits for initialization before enabling the gesture', async () => {
  vi.stubGlobal('google', undefined);
  const a = setup(), b = setup();
  expect(document.querySelectorAll(`#${SCRIPT_ID}`)).toHaveLength(1);
  const script = document.getElementById(SCRIPT_ID);
  expect(script.src).toBe('https://accounts.google.com/gsi/client');
  expect(a.result.current.ready).toBe(false);
  await expect(a.result.current.authorize()).rejects.toThrow(/loading|ready/i);
  act(() => { googleReady(); script.dispatchEvent(new Event('load')); vi.advanceTimersByTime(100); });
  expect(a.result.current.ready).toBe(true); expect(b.result.current.ready).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('honors an existing legacy GIS script without replacing its handlers', () => {
  vi.stubGlobal('google', undefined);
  const script = document.createElement('script'); script.id = SCRIPT_ID;
  script.src = 'https://accounts.google.com/gsi/client';
  const legacy = vi.fn(); script.onload = legacy; document.head.appendChild(script);
  const { result } = setup();
  act(() => { googleReady(); script.dispatchEvent(new Event('load')); });
  expect(result.current.ready).toBe(true); expect(legacy).toHaveBeenCalledOnce();
  expect(document.querySelectorAll(`#${SCRIPT_ID}`)).toHaveLength(1);
});

it.each(['error', 'timeout'])('bounds script %s and cleans up listeners/timers', async mode => {
  vi.stubGlobal('google', undefined);
  const { result, unmount } = setup();
  act(() => {
    if (mode === 'error') document.getElementById(SCRIPT_ID).dispatchEvent(new Event('error'));
    else vi.advanceTimersByTime(15_000);
  });
  expect(result.current.ready).toBe(false); expect(result.current.error).toMatch(/load|unavailable/i);
  unmount(); expect(vi.getTimerCount()).toBe(0);
});
