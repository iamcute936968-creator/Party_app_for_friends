import { afterEach, expect, it, vi } from 'vitest';
import { createIceConfiguration } from '../../src/rtc/iceConfiguration';

const auth = { roomId: 'ROOM_A', roomSecret: 'private-room-secret', username: 'Guest', firebaseIdToken: 'private-id-token', uid: 'guest-uid' };
const iceServers = [{ urls: ['stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
    username: 'temporary-user', credential: 'temporary-credential' }];
const data = (time = 0) => ({ iceServers, expiresAt: time + 21600000 });
const response = (body = data()) => ({ ok: true, status: 200, json: async () => body });
const setup = options => {
  const fetchFn = vi.fn().mockResolvedValue(response());
  const onStatus = vi.fn();
  const getAuthorization = vi.fn().mockResolvedValue(auth);
  return { fetchFn, onStatus, getAuthorization, get: createIceConfiguration({ proxyUrl: 'https://proxy.example/', fetchFn,
    getAuthorization, now: () => 0, onStatus, ...options }) };
};
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
afterEach(() => vi.useRealTimers());

it('accepts scoped Metered relay credentials without permitting arbitrary relay hosts', async () => {
  const servers = [{ urls: ['stun:stun.relay.metered.ca:80'] },
    { urls: ['turn:global.relay.metered.ca:80', 'turns:global.relay.metered.ca:443?transport=tcp'], username: 'temporary-user', credential: 'temporary-password' }];
  const item = setup({ fetchFn: vi.fn().mockResolvedValue(response({ iceServers: servers, expiresAt: 21600000 })) });
  expect(await item.get()).toEqual({ iceServers: servers });
  expect(item.onStatus).toHaveBeenLastCalledWith('relay');
});

it('posts room authorization without UID and caches until the one-hour refresh margin', async () => {
  let time = 0;
  const item = setup({ now: () => time });
  expect(await item.get()).toEqual({ iceServers });
  expect(await item.get()).toEqual({ iceServers });
  expect(item.fetchFn).toHaveBeenCalledTimes(1);
  const [url, request] = item.fetchFn.mock.calls[0];
  expect(url).toBe('https://proxy.example/api/rtc/ice');
  expect(request).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/json' } });
  expect(JSON.parse(request.body)).toEqual({ roomId: auth.roomId, roomSecret: auth.roomSecret,
    username: auth.username, firebaseIdToken: auth.firebaseIdToken });
  expect(request.signal).toBeInstanceOf(AbortSignal);
  time = 18000000;
  await item.get();
  expect(item.fetchFn).toHaveBeenCalledTimes(2);
  expect(item.onStatus).toHaveBeenLastCalledWith('relay');
});

it('shares one pending request per identity scope and starts fresh for room, UID or name changes', async () => {
  let identity = auth;
  const pending = deferred();
  const fetchFn = vi.fn().mockReturnValue(pending.promise);
  const item = setup({ fetchFn, getAuthorization: async () => identity });
  const first = item.get(); const second = item.get();
  await Promise.resolve();
  expect(fetchFn).toHaveBeenCalledTimes(1);
  pending.resolve(response());
  await Promise.all([first, second]);
  fetchFn.mockResolvedValue(response());
  for (const change of [{ roomId: 'ROOM_B' }, { uid: 'other-uid' }, { username: 'Other' }]) {
    identity = { ...identity, ...change };
    await item.get();
  }
  expect(fetchFn).toHaveBeenCalledTimes(4);
});

it('an old completion cannot overwrite the active identity cache or status', async () => {
  let identity = auth;
  const stale = deferred();
  const onStatus = vi.fn();
  const fetchFn = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue(response());
  const item = setup({ fetchFn, onStatus, getAuthorization: async () => identity });
  const first = item.get(); await Promise.resolve();
  identity = { ...auth, uid: 'new-uid' };
  await item.get();
  stale.resolve({ ok: false, status: 503 });
  await first;
  await item.get();
  expect(fetchFn).toHaveBeenCalledTimes(2);
  expect(onStatus.mock.calls).toEqual([['relay'], ['relay']]);
});

it('does not let slow old authorization replace a newer room scope', async () => {
  const stale = deferred();
  const getAuthorization = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue({ ...auth, roomId: 'ROOM_B' });
  const item = setup({ getAuthorization });
  const first = item.get();
  await item.get();
  stale.resolve(auth); await first;
  await item.get();
  expect(item.fetchFn).toHaveBeenCalledTimes(2);
});

it('does not cache credentials inside their refresh margin and protects cached values from caller mutation', async () => {
  const fetchFn = vi.fn().mockResolvedValue(response({ iceServers, expiresAt: 1000 }));
  const short = setup({ fetchFn });
  await short.get(); await short.get();
  expect(fetchFn).toHaveBeenCalledTimes(2);
  const item = setup();
  const result = await item.get();
  result.iceServers[1].credential = 'changed';
  result.iceServers[1].urls.push('turn:injected.example:3478');
  expect(await item.get()).toEqual({ iceServers });
  expect(item.fetchFn).toHaveBeenCalledTimes(1);
});

it('masks authorization supplier errors and requires complete scope without falling back', async () => {
  for (const getAuthorization of [async () => { throw new Error(auth.roomSecret); }, async () => ({ ...auth, uid: '' })]) {
    const item = setup({ getAuthorization });
    await expect(item.get()).rejects.toThrow('Room authorization is required.');
    expect(item.fetchFn).not.toHaveBeenCalled();
    expect(item.onStatus).not.toHaveBeenCalled();
  }
});

it('falls back to STUN for unavailable relay and retries direct results after at most 30 seconds', async () => {
  let time = 0;
  const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503 });
  const item = setup({ now: () => time, fetchFn });
  const first = await item.get();
  expect(first.iceServers.every(server => server.urls.every(url => url.startsWith('stun:')))).toBe(true);
  expect(item.onStatus).toHaveBeenLastCalledWith('direct');
  time = 29999; await item.get();
  expect(fetchFn).toHaveBeenCalledTimes(1);
  time = 30000; await item.get();
  expect(fetchFn).toHaveBeenCalledTimes(2);
  const network = setup({ fetchFn: async () => { throw new Error(auth.roomSecret); } });
  expect(await network.get()).toEqual(first);
});

it.each([401, 403])('fails generically on authorization status %s without STUN fallback or secret exposure', async status => {
  const item = setup({ fetchFn: async () => ({ ok: false, status, json: async () => { throw new Error(auth.firebaseIdToken); } }) });
  await expect(item.get()).rejects.toThrow('Room authorization is required.');
  expect(item.onStatus).not.toHaveBeenCalledWith('direct');
});

it('uses safe direct fallback for missing or invalid proxy URLs and never transmits authorization there', async () => {
  for (const proxyUrl of ['', 'http://remote.example', 'https://name:secret@proxy.example', 'https://proxy.example?q=private',
    'https://proxy.example#private', 'javascript:alert(1)']) {
    const item = setup({ proxyUrl });
    expect((await item.get()).iceServers[0].urls[0]).toMatch(/^stun:/);
    expect(item.fetchFn).not.toHaveBeenCalled();
  }
  const local = setup({ proxyUrl: 'http://127.0.0.1:3000' });
  await local.get();
  expect(local.fetchFn.mock.calls[0][0]).toBe('http://127.0.0.1:3000/api/rtc/ice');
  const path = setup({ proxyUrl: 'https://proxy.example/base/' });
  await path.get();
  expect(path.fetchFn.mock.calls[0][0]).toBe('https://proxy.example/base/api/rtc/ice');
});

it('rejects injected ICE URLs, expired responses, unbounded credentials and strips extra response fields', async () => {
  for (const body of [{}, { iceServers, expiresAt: -1 }, { iceServers, expiresAt: '21600000' },
    { iceServers: [{ ...iceServers[1], urls: ['turn:evil.example:3478?transport=udp'] }], expiresAt: 21600000 },
    { iceServers: [{ ...iceServers[1], credential: 'x'.repeat(1025) }], expiresAt: 21600000 }]) {
    const item = setup({ fetchFn: async () => response(body) });
    expect((await item.get()).iceServers[0].urls[0]).toMatch(/^stun:/);
    expect(item.onStatus).toHaveBeenLastCalledWith('direct');
  }
  const item = setup({ fetchFn: async () => response({ ...data(), private: auth.roomSecret,
    iceServers: iceServers.map(server => ({ ...server, private: auth.firebaseIdToken })) }) });
  expect(await item.get()).toEqual({ iceServers });
});

it('enforces a five-second deadline even when fetch or response parsing ignores cancellation', async () => {
  vi.useFakeTimers();
  for (const stage of ['fetch', 'body']) {
    let signal;
    const item = setup({ fetchFn: async (_url, request) => {
      signal = request.signal;
      return stage === 'fetch' ? new Promise(() => {}) : { ok: true, json: () => new Promise(() => {}) };
    } });
    const pending = item.get();
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).iceServers[0].urls[0]).toMatch(/^stun:/);
    expect(signal.aborted).toBe(true);
    expect(item.onStatus).toHaveBeenLastCalledWith('direct');
  }
});
