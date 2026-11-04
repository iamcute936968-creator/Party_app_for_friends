export async function attachAnimeHls(video, sourceUrl, { loadHls = () => import('hls.js'), onError = () => {}, signal } = {}) {
  let hls, ownsSource = false, released = false, phase = 'idle', remotePlaybackChanged = false, importTimer;
  const originalRemotePlayback = video.disableRemotePlayback;
  const fail = error => { if (!released && phase !== 'failed') { phase = 'failed'; onError(error); } };
  const clearSource = () => { if (ownsSource) { video.pause(); video.removeAttribute('src'); video.load(); } };
  const release = () => {
    if (released) return; released = true; signal?.removeEventListener('abort', release);
    clearTimeout(importTimer);
    video.removeEventListener?.('error', nativeError);
    hls?.destroy(); clearSource();
    if (remotePlaybackChanged) video.disableRemotePlayback = originalRemotePlayback;
  };
  const startJs = async () => {
    phase = 'loading';
    let Hls;
    try {
      ({ default: Hls } = await Promise.race([Promise.resolve(loadHls()), new Promise((_, reject) => {
        importTimer = setTimeout(() => reject(new Error('HLS initialization timed out.')), 15000);
      })]));
    } finally { clearTimeout(importTimer); }
    if (released || signal?.aborted) return;
    if (!Hls.isSupported()) throw new Error('HLS is unavailable in this browser.');
    clearSource();
    // Safari's ManagedMediaSource requires remote playback to be disabled.
    // This is only used for compatibility playback; restore it on release.
    if (typeof globalThis.ManagedMediaSource === 'function' && !video.disableRemotePlayback) {
      video.disableRemotePlayback = true; remotePlaybackChanged = true;
    }
    phase = 'js';
    hls = new Hls({
      startLevel: 0, capLevelToPlayerSize: true, maxBufferSize: 20 * 1024 * 1024,
      maxBufferLength: 20, maxMaxBufferLength: 40, backBufferLength: 15, enableWorker: false,
    });
    hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail({ code: 2 }); });
    ownsSource = true; hls.attachMedia(video); hls.loadSource(sourceUrl);
  };
  const nativeError = () => {
    if (released || !video.error || phase === 'loading' || phase === 'failed') return;
    const error = { code: video.error.code };
    if (phase === 'native' && [3, 4].includes(error.code)) void startJs().catch(() => fail(error));
    else fail(error);
  };
  try {
    if (signal?.aborted) return release;
    signal?.addEventListener('abort', release, { once: true });
    video.addEventListener?.('error', nativeError);
    if (video.canPlayType('application/vnd.apple.mpegurl')) { phase = 'native'; ownsSource = true; video.src = sourceUrl; }
    else await startJs();
    return release;
  } catch { release(); throw new Error('Video playback is unavailable.'); }
}
