/**
 * HTML5Adapter.js
 *
 * Wraps a native HTMLVideoElement behind the MediaAdapter interface so that
 * App.jsx sync logic can drive Drive video identically to YouTube.
 *
 * Key iOS / Safari notes:
 *  - video.play() returns a Promise; rejection means autoplay was blocked.
 *    The adapter propagates the rejection so the caller can handle it
 *    (show Tap-to-Sync, retry from user gesture).
 *  - HTMLVideoElement emits 'pause' during seek; the adapter suppresses it.
 *  - 'pause' fires just before 'ended'; the adapter suppresses it when ending.
 *  - Only 'PLAYING' | 'PAUSED' | 'ENDED' are forwarded via onStateChange.
 *
 * MediaAdapter interface: see YouTubeAdapter.js header for full spec.
 */

/**
 * Derive a normalized state string from a live HTMLVideoElement.
 *
 * @param {HTMLVideoElement} video
 * @returns {'PLAYING'|'PAUSED'|'ENDED'|'BUFFERING'|'UNSTARTED'}
 */
function deriveState(video) {
  if (!video) return 'UNSTARTED';
  if (video.readyState === 0) return 'UNSTARTED';
  if (video.ended) return 'ENDED';
  if (video.readyState < 3 && !video.paused) return 'BUFFERING';
  if (!video.paused) return 'PLAYING';
  return 'PAUSED';
}

/**
 * Create an HTML5 MediaAdapter bound to an existing <video> DOM element.
 *
 * @param {HTMLVideoElement} videoEl  The <video> element (already in the DOM)
 * @param {string}           blobUrl  ObjectURL for the video (e.g. blob:http://...)
 * @returns {Object}                  MediaAdapter instance
 */
export function createHTML5Adapter(videoEl, blobUrl) {
  let readyCb = null;
  let stateChangeCb = null;
  let errorCb = null;
  let destroyed = false;
  // Guard against emitting PAUSED while a seek is in progress or the video
  // is transitioning to ENDED (HTMLVideoElement fires 'pause' → 'ended').
  let seekInProgress = false;
  let endingInProgress = false;

  // ------------------------------------------------------------------
  // Internal event handlers — kept in named references so they can be
  // removed cleanly in destroy().
  // ------------------------------------------------------------------

  function onLoadedMetadata() {
    if (destroyed) return;
    readyCb?.();
  }

  function onPlaying() {
    if (destroyed) return;
    seekInProgress = false;
    endingInProgress = false;
    stateChangeCb?.('PLAYING');
  }

  function onPause() {
    if (destroyed) return;
    // Suppress seek-induced pause events and the pause that precedes 'ended'.
    if (seekInProgress || endingInProgress) return;
    stateChangeCb?.('PAUSED');
  }

  function onEnded() {
    if (destroyed) return;
    endingInProgress = false;
    stateChangeCb?.('ENDED');
  }

  function onSeeking() {
    seekInProgress = true;
  }

  function onSeeked() {
    seekInProgress = false;
  }

  function onError() {
    if (destroyed) return;
    errorCb?.(videoEl.error);
  }

  // Register all listeners on the element.
  videoEl.addEventListener('loadedmetadata', onLoadedMetadata);
  videoEl.addEventListener('playing', onPlaying);
  videoEl.addEventListener('pause', onPause);
  videoEl.addEventListener('ended', onEnded);
  videoEl.addEventListener('seeking', onSeeking);
  videoEl.addEventListener('seeked', onSeeked);
  videoEl.addEventListener('error', onError);

  // Assign the blob URL and begin loading.
  videoEl.src = blobUrl;
  videoEl.load();

  // ------------------------------------------------------------------
  // Public adapter
  // ------------------------------------------------------------------
  const adapter = {
    // Queries
    getCurrentTime() {
      return videoEl?.currentTime ?? 0;
    },

    getDuration() {
      const d = videoEl?.duration;
      return (typeof d === 'number' && Number.isFinite(d) && d > 0) ? d : NaN;
    },

    getState() {
      return deriveState(videoEl);
    },

    // Commands

    /**
     * Attempt to play.  Returns a Promise that rejects if the browser
     * (e.g. iOS Safari) blocks autoplay.  Callers should catch the rejection
     * and show Tap-to-Sync if needed.
     */
    play() {
      if (!videoEl) return Promise.reject(new Error('No video element'));
      return videoEl.play();
    },

    pause() {
      try { videoEl?.pause(); } catch { /* swallow */ }
    },

    seek(time) {
      if (!videoEl) return;
      // Guard: only seek if metadata is available.
      if (videoEl.readyState < 1) return;
      videoEl.currentTime = time;
    },

    // Lifecycle
    destroy({ revokeObjectUrl = true } = {}) {
      if (destroyed) return;
      destroyed = true;

      // Remove all registered listeners.
      videoEl.removeEventListener('loadedmetadata', onLoadedMetadata);
      videoEl.removeEventListener('playing', onPlaying);
      videoEl.removeEventListener('pause', onPause);
      videoEl.removeEventListener('ended', onEnded);
      videoEl.removeEventListener('seeking', onSeeking);
      videoEl.removeEventListener('seeked', onSeeked);
      videoEl.removeEventListener('error', onError);

      // Stop playback, release media resource.
      try { videoEl.pause(); } catch { /* swallow */ }
      videoEl.removeAttribute('src');
      videoEl.load(); // Releases media resource per HTML spec.

      // Revoke the ObjectURL to free the Blob's memory.
      if (revokeObjectUrl && blobUrl) {
        try { URL.revokeObjectURL(blobUrl); } catch { /* swallow */ }
      }

      readyCb = null;
      stateChangeCb = null;
      errorCb = null;
    },

    // Event registration
    onReady(cb) { readyCb = cb; },
    onStateChange(cb) { stateChangeCb = cb; },
    onError(cb) { errorCb = cb; },

    // Expose for callers that need to know the ending-guard state.
    _setEndingInProgress(v) { endingInProgress = v; },
  };

  return adapter;
}
