import { expect, it, vi } from 'vitest';
import { createHTML5Adapter } from '../../src/adapters/HTML5Adapter';
it('observes externally managed HLS without replacing or unloading its MediaSource', () => {
  const video = document.createElement('video'); video.src = 'blob:https://party.example/hls-owned';
  vi.spyOn(video, 'load').mockImplementation(() => {}); vi.spyOn(video, 'pause').mockImplementation(() => {});
  const before = video.src, adapter = createHTML5Adapter(video, undefined, { manageSource: false });
  expect(video.src).toBe(before); expect(video.load).not.toHaveBeenCalled();
  adapter.destroy(); expect(video.src).toBe(before); expect(video.load).not.toHaveBeenCalled();
});
it('keeps Drive source ownership and cleanup as the default', () => {
  const video = document.createElement('video'); vi.spyOn(video, 'load').mockImplementation(() => {}); vi.spyOn(video, 'pause').mockImplementation(() => {});
  const adapter = createHTML5Adapter(video, 'https://proxy.example/media/video');
  expect(video.src).toBe('https://proxy.example/media/video'); expect(video.load).toHaveBeenCalledTimes(1);
  adapter.destroy({ revokeObjectUrl: false }); expect(video.hasAttribute('src')).toBe(false); expect(video.load).toHaveBeenCalledTimes(2);
});
