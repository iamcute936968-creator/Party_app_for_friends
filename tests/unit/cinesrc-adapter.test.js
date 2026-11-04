import { afterEach, expect, it, vi } from 'vitest';
import { createCineSrcAdapter } from '../../src/adapters/CineSrcAdapter';
import { reconcilePlayback } from '../../src/media/playbackSync';
afterEach(() => { vi.useRealTimers(); });
function setup() {
  const frame = { postMessage: vi.fn() }, adapter = createCineSrcAdapter(frame), ready = vi.fn(), state = vi.fn(), error = vi.fn();
  adapter.onReady(ready); adapter.onStateChange(state); adapter.onError(error);
  const send = (data, origin = 'https://cinesrc.st', source = frame) => window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
  return { frame, adapter, ready, state, error, send };
}
it('binds messages to the exact iframe and origin and emits readiness once', () => {
  const p = setup(); p.send({ type: 'cinesrc:ready' }, 'https://evil.example'); p.send({ type: 'cinesrc:ready' }, 'https://cinesrc.st', {}); expect(p.ready).not.toHaveBeenCalled();
  p.send({ type: 'cinesrc:ready' }); p.send({ type: 'cinesrc:ready' }); expect(p.ready).toHaveBeenCalledOnce(); p.adapter.destroy();
});
it('uses documented commands, validates progress and reports native player state', () => {
  const p = setup(); p.send({ type: 'cinesrc:ready' });
  p.adapter.play(); p.adapter.pause(); p.adapter.seek(42);
  expect(p.frame.postMessage).toHaveBeenCalledWith({ type: 'cinesrc:command', command: 'seek', args: [42] }, 'https://cinesrc.st');
  p.send({ type: 'cinesrc:loadedmetadata', duration: 600 }); p.send({ type: 'cinesrc:seeked', currentTime: 42, duration: 600 }); p.send({ type: 'cinesrc:play' }); p.send({ type: 'cinesrc:timeupdate', currentTime: 43, duration: 600 });
  expect(p.adapter.getCurrentTime()).toBe(43); expect(p.adapter.getDuration()).toBe(600); expect(p.adapter.getState()).toBe('PLAYING'); expect(p.state).toHaveBeenCalledWith('PLAYING');
  for (const data of [{ type: 'cinesrc:timeupdate', currentTime: -1, duration: 600 }, { type: 'cinesrc:timeupdate', currentTime: 700, duration: 600 }, { type: 'cinesrc:timeupdate', currentTime: 1, duration: Infinity }, { type: 'cinesrc:response', command: 'getCurrentTime', result: -30 }]) p.send(data);
  expect(p.adapter.getCurrentTime()).toBe(43);
  p.adapter.seek(NaN); p.adapter.seek(-1); expect(p.frame.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ args: [NaN] }), expect.anything());
  p.adapter.destroy();
});
it('rejects malformed messages, reports safe errors and retires commands and timers on destruction', () => {
  vi.useFakeTimers(); const p = setup(); p.send(null); p.send('bad json'); p.send({ type: 'cinesrc:error', error: 'https://private.example/token=secret' });
  expect(p.error).toHaveBeenCalledWith({ code: 'unavailable' }); p.adapter.destroy(); const calls = p.frame.postMessage.mock.calls.length;
  p.send({ type: 'cinesrc:play' }); p.send({ type: 'cinesrc:ready' }); p.adapter.play(); vi.advanceTimersByTime(60000);
  expect(p.frame.postMessage).toHaveBeenCalledTimes(calls); expect(p.ready).not.toHaveBeenCalled(); expect(p.state).not.toHaveBeenCalled();
});
it('marks an in-player episode change unavailable until the canonical room selection is restored', () => {
  const p = setup(); p.send({ type: 'cinesrc:nextepisode', season: 1, episode: 2 }); expect(p.error).toHaveBeenCalledWith({ code: 'selection-changed' }); p.adapter.destroy();
});
it('reports delayed metadata discovered through getters once for initial clock alignment', () => {
  const p = setup(), metadata = vi.fn(); p.adapter.onMetadata(metadata); p.send({ type: 'cinesrc:ready' });
  p.send({ type: 'cinesrc:response', command: 'getDuration', result: 600 }); p.send({ type: 'cinesrc:response', command: 'getDuration', result: 600 });
  expect(metadata).toHaveBeenCalledOnce(); p.adapter.destroy();
});
it('allows a slow provider to initialize before reporting a bounded timeout', () => {
  vi.useFakeTimers(); const p = setup(); vi.advanceTimersByTime(45000); expect(p.error).not.toHaveBeenCalled();
  vi.advanceTimersByTime(15001); expect(p.error).toHaveBeenCalledWith({ code: 'unavailable' }); p.adapter.destroy();
});
it('does not chase the room clock with seek commands while the first frames are still buffering', () => {
  const p = setup(); p.send({ type: 'cinesrc:ready' }); p.send({ type: 'cinesrc:loadedmetadata', duration: 600 });
  p.adapter.play(); p.send({ type: 'cinesrc:play' }); expect(p.adapter.getState()).toBe('BUFFERING');
  p.send({ type: 'cinesrc:response', command: 'getCurrentTime', result: 5 });
  reconcilePlayback(p.adapter, { playbackState: 'PLAYING', anchorTime: 50, updatedAt: Date.now() });
  expect(p.frame.postMessage.mock.calls.filter(([data]) => data.command === 'seek')).toHaveLength(0);
  p.send({ type: 'cinesrc:timeupdate', currentTime: 5.1, duration: 600 }); expect(p.adapter.getState()).toBe('PLAYING'); p.adapter.destroy();
});
it('ignores seek-induced pauses and resumes corrections only after advancing media progress', () => {
  const p = setup(); p.send({ type: 'cinesrc:ready' }); p.send({ type: 'cinesrc:loadedmetadata', duration: 600 }); p.send({ type: 'cinesrc:play' }); p.send({ type: 'cinesrc:timeupdate', currentTime: 1, duration: 600 });
  p.adapter.seek(42); p.send({ type: 'cinesrc:seeking', currentTime: 42, duration: 600 }); p.send({ type: 'cinesrc:pause' });
  expect(p.adapter.getState()).toBe('BUFFERING'); expect(p.state).not.toHaveBeenCalledWith('PAUSED');
  p.send({ type: 'cinesrc:seeked', currentTime: 42, duration: 600 }); p.send({ type: 'cinesrc:timeupdate', currentTime: 42.2, duration: 600 }); expect(p.adapter.getState()).toBe('PLAYING');
  p.adapter.pause(); p.send({ type: 'cinesrc:pause' }); expect(p.adapter.getState()).toBe('PAUSED'); p.adapter.destroy();
});
it('finishes a paused seek from confirmed progress and can resume when the provider omits seeked', () => {
  const p = setup(), seek = vi.fn(); p.adapter.onSeek(seek); p.send({ type: 'cinesrc:ready' }); p.send({ type: 'cinesrc:loadedmetadata', duration: 600 });
  p.adapter.seek(42); p.send({ type: 'cinesrc:seeking', currentTime: 42, duration: 600 }); p.send({ type: 'cinesrc:response', command: 'getCurrentTime', result: 42 });
  expect(p.adapter.getState()).toBe('PAUSED'); expect(seek).toHaveBeenCalledOnce();
  p.adapter.play(); p.send({ type: 'cinesrc:play' }); p.send({ type: 'cinesrc:timeupdate', currentTime: 42.3, duration: 600 });
  expect(p.adapter.getState()).toBe('PLAYING'); p.adapter.destroy();
});
