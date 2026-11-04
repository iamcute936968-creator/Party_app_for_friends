import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVoiceRecorder } from '../../src/hooks/useVoiceRecorder';
let recorders, createUrl, revokeUrl;
const track = () => ({ readyState: 'live', stop: vi.fn() });
const stream = (ownedTrack = track()) => ({ getTracks: () => [ownedTrack], getAudioTracks: () => [ownedTrack] });
class Recorder {
  static isTypeSupported = type => type === 'audio/webm;codecs=opus';
  constructor(source, options) { this.source = source; this.options = options; this.mimeType = options.mimeType; this.state = 'inactive'; recorders.push(this); }
  start(slice) { this.state = 'recording'; this.slice = slice; }
  stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); }
  emit(blob = new Blob(['audio'], { type: this.mimeType })) { this.ondataavailable?.({ data: blob }); }
}
beforeEach(() => {
  vi.useFakeTimers(); recorders = []; createUrl = vi.fn(() => 'blob:voice-preview'); revokeUrl = vi.fn();
  vi.stubGlobal('MediaRecorder', Recorder); vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => stream()) } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const start = async result => { await act(async () => { await result.current.start(); }); };
const preview = async result => {
  act(() => { vi.advanceTimersByTime(1000); recorders.at(-1).emit(); });
  await act(async () => { result.current.stop(); await Promise.resolve(); });
};
it('records only after explicit start, releases owned tracks, previews and sends once', async () => {
  const owned = track(), original = track(), getStream = vi.fn(async () => stream(owned)), onSend = vi.fn(async () => true);
  const { result } = renderHook(() => useVoiceRecorder({ scope: 'room/user', getStream, onSend }));
  expect(getStream).not.toHaveBeenCalled(); expect(result.current.supported).toBe(true);
  await start(result); expect(result.current.status).toBe('recording'); expect(recorders[0].options.audioBitsPerSecond).toBe(32000); expect(recorders[0].slice).toBe(250);
  await preview(result); expect(result.current.status).toBe('preview'); expect(result.current.previewUrl).toBe('blob:voice-preview'); expect(result.current.durationMs).toBe(1000);
  expect(owned.stop).toHaveBeenCalledOnce(); expect(original.stop).not.toHaveBeenCalled();
  await act(async () => { await Promise.all([result.current.send(), result.current.send()]); });
  expect(onSend).toHaveBeenCalledOnce(); expect(onSend).toHaveBeenCalledWith({ blob: expect.any(Blob), mimeType: 'audio/webm;codecs=opus', durationMs: 1000 });
  expect(result.current.status).toBe('idle'); expect(revokeUrl).toHaveBeenCalledWith('blob:voice-preview');
});
it('preserves preview on failed send and retries only after another explicit send', async () => {
  const onSend = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(Error('private detail')).mockResolvedValueOnce(true);
  const { result } = renderHook(() => useVoiceRecorder({ scope: 'room/user', onSend }));
  await start(result); await preview(result);
  await act(async () => { await result.current.send(); }); expect(result.current.status).toBe('preview'); expect(result.current.error).toContain('try again'); expect(revokeUrl).not.toHaveBeenCalled();
  await act(async () => { await result.current.send(); }); expect(result.current.error).not.toContain('private detail'); expect(result.current.previewUrl).toBe('blob:voice-preview');
  await act(async () => { await result.current.send(); }); expect(result.current.status).toBe('idle'); expect(onSend).toHaveBeenCalledTimes(3);
});
it('finishes locally after disconnect and waits until enabled before sending', async () => {
  const onSend = vi.fn(async () => true);
  const { result, rerender } = renderHook(({ enabled }) => useVoiceRecorder({ scope: 'room/user', onSend, enabled }), { initialProps: { enabled: true } });
  await start(result); rerender({ enabled: false }); await preview(result);
  await act(async () => { await result.current.send(); }); expect(onSend).not.toHaveBeenCalled(); expect(result.current.status).toBe('preview');
  rerender({ enabled: true }); await act(async () => { await result.current.send(); }); expect(onSend).toHaveBeenCalledOnce();
});
it('auto-stops at fifteen seconds and rejects oversized recordings without retaining audio', async () => {
  const owned = track(), getStream = async () => stream(owned);
  const { result } = renderHook(() => useVoiceRecorder({ scope: 'room/user', getStream }));
  await start(result); act(() => recorders[0].emit());
  await act(async () => { vi.advanceTimersByTime(15000); await Promise.resolve(); });
  expect(result.current.status).toBe('preview'); expect(result.current.durationMs).toBeLessThanOrEqual(15000); expect(result.current.durationMs).toBeGreaterThanOrEqual(14500); expect(owned.stop).toHaveBeenCalledOnce();
  act(() => result.current.cancel()); await start(result);
  act(() => recorders[1].emit(new Blob([new Uint8Array(128 * 1024 + 1)])));
  expect(result.current.status).toBe('idle'); expect(result.current.error).toContain('large'); expect(result.current.previewUrl).toBe('');
});
it('invalidates late permission results after cancel, scope change and unmount', async () => {
  let finish; const owned = track(), getStream = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const { result, rerender, unmount } = renderHook(({ scope }) => useVoiceRecorder({ scope, getStream }), { initialProps: { scope: 'first' } });
  let pending; act(() => { pending = result.current.start(); }); expect(result.current.status).toBe('acquiring'); act(() => result.current.cancel());
  await act(async () => { finish(stream(owned)); await pending; }); expect(owned.stop).toHaveBeenCalledOnce(); expect(recorders).toHaveLength(0);
  act(() => { pending = result.current.start(); }); rerender({ scope: 'second' });
  const second = track(); await act(async () => { finish(stream(second)); await pending; }); expect(second.stop).toHaveBeenCalledOnce(); expect(result.current.status).toBe('idle');
  act(() => { pending = result.current.start(); }); unmount(); const third = track(); await act(async () => { finish(stream(third)); await pending; }); expect(third.stop).toHaveBeenCalledOnce();
});
it('cleans previews and suppresses a stale send completion after a scope change', async () => {
  let finish; const onSend = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const { result, rerender, unmount } = renderHook(({ scope }) => useVoiceRecorder({ scope, onSend }), { initialProps: { scope: 'first' } });
  await start(result); await preview(result); let pending; act(() => { pending = result.current.send(); }); expect(result.current.status).toBe('sending');
  rerender({ scope: 'second' }); await act(async () => { finish(true); await pending; }); expect(result.current.status).toBe('idle'); expect(result.current.previewUrl).toBe(''); expect(revokeUrl).toHaveBeenCalledOnce();
  await start(result); await preview(result); unmount(); expect(revokeUrl).toHaveBeenCalledTimes(2);
});
it('handles unsupported browsers and permission failures without exposing provider details', async () => {
  vi.stubGlobal('MediaRecorder', undefined);
  const first = renderHook(() => useVoiceRecorder({ scope: 'room/user' })); expect(first.result.current.supported).toBe(false); await start(first.result); expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled(); first.unmount();
  vi.stubGlobal('MediaRecorder', Recorder); navigator.mediaDevices.getUserMedia.mockRejectedValue(Error('private microphone error'));
  const second = renderHook(() => useVoiceRecorder({ scope: 'room/user' })); await start(second.result); expect(second.result.current.status).toBe('idle'); expect(second.result.current.error).toContain('microphone'); expect(second.result.current.error).not.toContain('private');
});
it('releases an active recorder and its timers when cancelled or unmounted', async () => {
  const owned = track(), getStream = async () => stream(owned), { result, unmount } = renderHook(() => useVoiceRecorder({ scope: 'room/user', getStream }));
  await start(result); const late = recorders[0].onstop; act(() => result.current.cancel()); expect(owned.stop).toHaveBeenCalledOnce();
  await act(async () => { late?.(); vi.advanceTimersByTime(30000); }); expect(result.current.status).toBe('idle'); expect(createUrl).not.toHaveBeenCalled();
  await start(result); unmount(); expect(owned.stop).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
});
it('rejects a recording whose clock exceeds the duration limit instead of mislabelling it as shorter', async () => {
  const { result } = renderHook(() => useVoiceRecorder({ scope: 'room/user' }));
  await start(result); act(() => { vi.setSystemTime(Date.now() + 16000); recorders[0].emit(); });
  await act(async () => { result.current.stop(); await Promise.resolve(); });
  expect(result.current.status).toBe('idle'); expect(result.current.error).toContain('15-second'); expect(createUrl).not.toHaveBeenCalled();
});
it('releases the microphone if the native recorder never finalizes its stop event', async () => {
  const owned = track(), { result } = renderHook(() => useVoiceRecorder({ scope: 'room/user', getStream: async () => stream(owned) }));
  await start(result); const late = recorders[0].onstop; recorders[0].stop = function () { this.state = 'inactive'; };
  act(() => { recorders[0].emit(); result.current.stop(); });
  await act(async () => { vi.advanceTimersByTime(1500); late(); });
  expect(owned.stop).toHaveBeenCalledOnce(); expect(result.current.status).toBe('idle'); expect(result.current.error).toContain('could not finish'); expect(createUrl).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
