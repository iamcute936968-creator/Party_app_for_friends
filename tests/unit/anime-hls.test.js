import { afterEach, expect, it, vi } from 'vitest';
import { attachAnimeHls } from '../../src/anime/hls';
const url = 'https://stream.animeparadise.moe/m3u8?url=opaque';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('prefers native HLS and releases the source when playback leaves the page', async () => {
  const video = { canPlayType: () => 'maybe', pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() };
  const loadHls = vi.fn(); const destroy = await attachAnimeHls(video, url, { loadHls });
  expect(video.src).toBe(url); expect(loadHls).not.toHaveBeenCalled();
  destroy(); expect(video.pause).toHaveBeenCalled(); expect(video.removeAttribute).toHaveBeenCalledWith('src');
});
it('starts lazy HLS at the lowest adaptive rendition with bounded buffering and destroys media on cleanup', async () => {
  const instance = { on: vi.fn(), attachMedia: vi.fn(), loadSource: vi.fn(), destroy: vi.fn() };
  const Hls = vi.fn(function () { return instance; }); Hls.isSupported = () => true; Hls.Events = { ERROR: 'error' };
  const video = { canPlayType: () => '', pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() }, onError = vi.fn();
  const destroy = await attachAnimeHls(video, url, { loadHls: async () => ({ default: Hls }), onError });
  expect(Hls).toHaveBeenCalledWith({
    startLevel: 0, capLevelToPlayerSize: true, maxBufferSize: 20 * 1024 * 1024,
    maxBufferLength: 20, maxMaxBufferLength: 40, backBufferLength: 15, enableWorker: false,
  });
  expect(instance.attachMedia).toHaveBeenCalledWith(video); expect(instance.loadSource).toHaveBeenCalledWith(url);
  instance.on.mock.calls[0][1]('error', { fatal: false }); expect(onError).not.toHaveBeenCalled();
  instance.on.mock.calls[0][1]('error', { fatal: true }); expect(onError).toHaveBeenCalledTimes(1);
  destroy(); expect(instance.destroy).toHaveBeenCalledTimes(1);
});

it('never attaches a late HLS import after its episode was cancelled', async () => {
  let resolve; const controller = new AbortController();
  const instance = { on: vi.fn(), attachMedia: vi.fn(), loadSource: vi.fn(), destroy: vi.fn() };
  function Hls() { return instance; } Hls.isSupported = () => true; Hls.Events = { ERROR: 'error' };
  const video = { src: 'new-episode', canPlayType: () => '', pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() };
  const pending = attachAnimeHls(video, url, { signal: controller.signal, loadHls: () => new Promise(done => { resolve = done; }) });
  controller.abort(); resolve({ default: Hls }); const stop = await pending; stop();
  expect(instance.attachMedia).not.toHaveBeenCalled(); expect(video.removeAttribute).not.toHaveBeenCalled();
});

it('tries the existing JavaScript engine once when native HLS reports a decode failure', async () => {
  const video = document.createElement('video');
  vi.spyOn(video, 'canPlayType').mockReturnValue('maybe'); vi.spyOn(video, 'pause').mockImplementation(() => {}); vi.spyOn(video, 'load').mockImplementation(() => {});
  Object.defineProperty(video, 'error', { configurable: true, value: { code: 3 } });
  const instance = { on: vi.fn(), attachMedia: vi.fn(), loadSource: vi.fn(), destroy: vi.fn() };
  const Hls = vi.fn(function () { return instance; }); Hls.isSupported = () => true; Hls.Events = { ERROR: 'error' };
  const loadHls = vi.fn(async () => ({ default: Hls })), onError = vi.fn();
  const stop = await attachAnimeHls(video, url, { loadHls, onError });
  video.dispatchEvent(new Event('error')); video.dispatchEvent(new Event('error'));
  await vi.waitFor(() => expect(instance.attachMedia).toHaveBeenCalledWith(video));
  expect(loadHls).toHaveBeenCalledTimes(1); expect(instance.loadSource).toHaveBeenCalledWith(url); expect(onError).not.toHaveBeenCalled();
  instance.on.mock.calls[0][1]('error', { fatal: true }); expect(onError).toHaveBeenCalledTimes(1);
  stop(); expect(instance.destroy).toHaveBeenCalledTimes(1);
});
it('reports native failure when compatibility playback is unavailable, without an unhandled rejection', async () => {
  const video = document.createElement('video'); vi.spyOn(video, 'canPlayType').mockReturnValue('maybe');
  vi.spyOn(video, 'pause').mockImplementation(() => {}); vi.spyOn(video, 'load').mockImplementation(() => {});
  Object.defineProperty(video, 'error', { value: { code: 4 } });
  const Hls = { isSupported: () => false }, onError = vi.fn();
  const stop = await attachAnimeHls(video, url, { loadHls: async () => ({ default: Hls }), onError });
  video.dispatchEvent(new Event('error'));
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 4 })));
  stop();
});
it('does not attach a compatibility engine after native recovery was cancelled', async () => {
  let finish; const video = document.createElement('video'), controller = new AbortController();
  vi.spyOn(video, 'canPlayType').mockReturnValue('maybe'); vi.spyOn(video, 'pause').mockImplementation(() => {}); vi.spyOn(video, 'load').mockImplementation(() => {});
  Object.defineProperty(video, 'error', { value: { code: 3 } });
  const Hls = vi.fn(); Hls.isSupported = () => true;
  const loadHls = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const stop = await attachAnimeHls(video, url, { signal: controller.signal, loadHls }); video.dispatchEvent(new Event('error'));
  await vi.waitFor(() => expect(loadHls).toHaveBeenCalledOnce());
  controller.abort(); finish({ default: Hls }); await Promise.resolve(); stop(); expect(Hls).not.toHaveBeenCalled();
});
it('bounds a stalled compatibility import and does not leave the failed native player waiting forever', async () => {
  vi.useFakeTimers();
  const video = document.createElement('video'); vi.spyOn(video, 'canPlayType').mockReturnValue('maybe');
  vi.spyOn(video, 'pause').mockImplementation(() => {}); vi.spyOn(video, 'load').mockImplementation(() => {});
  Object.defineProperty(video, 'error', { value: { code: 3 } });
  const onError = vi.fn(); const stop = await attachAnimeHls(video, url, { loadHls: () => new Promise(() => {}), onError });
  video.dispatchEvent(new Event('error')); await vi.advanceTimersByTimeAsync(15001);
  expect(onError).toHaveBeenCalledWith({ code: 3 }); stop();
});
it('enables ManagedMediaSource compatibility when needed and restores remote playback on exit', async () => {
  vi.stubGlobal('ManagedMediaSource', function () {});
  const video = document.createElement('video'); video.disableRemotePlayback = false;
  vi.spyOn(video, 'canPlayType').mockReturnValue('maybe'); vi.spyOn(video, 'pause').mockImplementation(() => {}); vi.spyOn(video, 'load').mockImplementation(() => {});
  Object.defineProperty(video, 'error', { value: { code: 3 } });
  const instance = { on: vi.fn(), attachMedia: vi.fn(), loadSource: vi.fn(), destroy: vi.fn() };
  function Hls() { return instance; } Hls.isSupported = () => true; Hls.Events = { ERROR: 'error' };
  const onError = vi.fn(), stop = await attachAnimeHls(video, url, { loadHls: async () => ({ default: Hls }), onError });
  video.dispatchEvent(new Event('error')); await vi.waitFor(() => expect(instance.attachMedia).toHaveBeenCalled());
  expect(video.disableRemotePlayback).toBe(true); stop(); expect(video.disableRemotePlayback).toBe(false);
  instance.on.mock.calls[0][1]('error', { fatal: true }); expect(onError).not.toHaveBeenCalled();
});

it('keeps a nonfatal upstream 403 pending, normalizes terminal failure and releases media on caller cleanup', async () => {
  const instance = { on: vi.fn(), attachMedia: vi.fn(), loadSource: vi.fn(), destroy: vi.fn() };
  const Hls = vi.fn(function () { return instance; }); Hls.isSupported = () => true; Hls.Events = { ERROR: 'error' };
  const video = { canPlayType: () => '', pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() }, onError = vi.fn();
  const stop = await attachAnimeHls(video, url, { loadHls: async () => ({ default: Hls }), onError });
  const upstreamError = { fatal: false, response: { code: 403, url: 'https://stream.animeparadise.moe/private?token=never-expose', text: 'Private upstream details' } };
  const onHlsError = instance.on.mock.calls[0][1];
  onHlsError('error', upstreamError);
  expect(onError).not.toHaveBeenCalled(); expect(instance.destroy).not.toHaveBeenCalled();
  onHlsError('error', { ...upstreamError, fatal: true });
  expect(onError).toHaveBeenCalledExactlyOnceWith({ code: 2 });
  expect(JSON.stringify(onError.mock.calls)).not.toContain('never-expose'); expect(JSON.stringify(onError.mock.calls)).not.toContain('Private upstream');
  stop(); stop(); expect(instance.destroy).toHaveBeenCalledOnce();
  expect(video.pause).toHaveBeenCalledOnce(); expect(video.removeAttribute).toHaveBeenCalledWith('src'); expect(video.load).toHaveBeenCalledOnce();
  onHlsError('error', { ...upstreamError, fatal: true }); expect(onError).toHaveBeenCalledOnce();
});
