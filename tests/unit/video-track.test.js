import { afterEach, expect, it, vi } from 'vitest';
import { createHTML5Adapter } from '../../src/adapters/HTML5Adapter';
afterEach(() => vi.restoreAllMocks());
function player(width, height, readyState = 4) {
  const video = document.createElement('video');
  Object.defineProperties(video, { readyState: { value: readyState }, duration: { value: 65.8 }, videoWidth: { value: width }, videoHeight: { value: height } });
  vi.spyOn(video, 'load').mockImplementation(() => {});
  vi.spyOn(video, 'pause').mockImplementation(() => {});
  vi.spyOn(video, 'play').mockResolvedValue();
  const adapter = createHTML5Adapter(video, 'blob:owned');
  const ready = vi.fn(), error = vi.fn(), state = vi.fn();
  adapter.onReady(ready); adapter.onError(error); adapter.onStateChange(state);
  video.dispatchEvent(new Event('loadedmetadata'));
  return { adapter, video, ready, error, state };
}
it('rejects an audio-only fallback instead of claiming an unsupported video is ready', async () => {
  const p = player(0, 0);
  expect(p.error).toHaveBeenCalledWith(expect.objectContaining({ code: 4 }));
  expect(p.ready).not.toHaveBeenCalled();
  expect(p.video.pause).toHaveBeenCalled();
  await expect(p.adapter.play()).rejects.toThrow(/video/i);
  expect(p.video.play).not.toHaveBeenCalled();
  p.video.dispatchEvent(new Event('playing'));
  expect(p.state).not.toHaveBeenCalledWith('PLAYING');
  p.adapter.destroy({ revokeObjectUrl: false });
});
it('keeps supported video ready and playable', async () => {
  const p = player(1280, 720);
  expect(p.ready).toHaveBeenCalledOnce(); expect(p.error).not.toHaveBeenCalled();
  await p.adapter.play(); expect(p.video.play).toHaveBeenCalledOnce();
  p.adapter.destroy({ revokeObjectUrl: false });
});
it('does not infer codec failure before metadata is available', () => {
  const p = player(0, 0, 0);
  expect(p.error).not.toHaveBeenCalled();
  p.adapter.destroy({ revokeObjectUrl: false });
});
it('leaves native error recovery to an external HLS owner and does not reject its early zero dimensions', () => {
  const video = document.createElement('video');
  Object.defineProperties(video, { readyState: { value: 1 }, duration: { value: 1400 }, videoWidth: { value: 0 }, videoHeight: { value: 0 }, error: { value: { code: 3 } } });
  vi.spyOn(video, 'pause').mockImplementation(() => {}); vi.spyOn(video, 'load').mockImplementation(() => {});
  const adapter = createHTML5Adapter(video, undefined, { manageSource: false, handleErrors: false });
  const ready = vi.fn(), error = vi.fn(); adapter.onReady(ready); adapter.onError(error);
  video.dispatchEvent(new Event('loadedmetadata')); video.dispatchEvent(new Event('error'));
  expect(ready).toHaveBeenCalledOnce(); expect(error).not.toHaveBeenCalled(); adapter.destroy();
});
it('ignores external engine reset pauses while retaining deliberate playback pauses', () => {
  const video = document.createElement('video');
  Object.defineProperties(video, { readyState: { configurable: true, value: 4 }, error: { configurable: true, value: { code: 3 } } });
  vi.spyOn(video, 'pause').mockImplementation(() => {});
  const adapter = createHTML5Adapter(video, undefined, { manageSource: false, handleErrors: false });
  const state = vi.fn(); adapter.onStateChange(state);
  video.dispatchEvent(new Event('pause')); expect(state).not.toHaveBeenCalled();
  Object.defineProperty(video, 'error', { value: null }); Object.defineProperty(video, 'readyState', { value: 0 });
  video.dispatchEvent(new Event('pause')); expect(state).not.toHaveBeenCalled();
  Object.defineProperty(video, 'readyState', { value: 4 });
  video.dispatchEvent(new Event('pause')); expect(state).toHaveBeenCalledWith('PAUSED'); adapter.destroy();
});
