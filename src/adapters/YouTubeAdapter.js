/**
 * YouTubeAdapter.js
 *
 * Wraps a YT.Player instance behind the MediaAdapter interface so that
 * App.jsx sync logic never touches the YouTube IFrame API directly.
 *
 * MediaAdapter interface:
 *   getCurrentTime() → number (seconds)
 *   getDuration()    → number (seconds, NaN if unknown)
 *   getState()       → 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'ENDED' | 'UNSTARTED'
 *   play()           → void
 *   pause()          → void
 *   seek(t)          → void
 *   destroy()        → void
 *   onReady(cb)      → void
 *   onStateChange(cb)→ void  (emits only 'PLAYING' | 'PAUSED' | 'ENDED')
 *   onError(cb)      → void
 */

// Map YT.PlayerState numeric codes to adapter state strings.
// Codes not listed here are not forwarded to onStateChange.
const YT_STATE_MAP = {
  0: 'ENDED',
  1: 'PLAYING',
  2: 'PAUSED',
  3: 'BUFFERING',
  5: 'CUED',
  [-1]: 'UNSTARTED',
};

/**
 * Create a YouTube MediaAdapter.
 *
 * @param {string} containerId   DOM element ID to mount the YT player into
 * @param {string} videoId       YouTube video ID (11-char)
 * @param {Object} playerVars    YT playerVars (controls, modestbranding, etc.)
 * @returns {Object}             MediaAdapter instance
 */
export function createYouTubeAdapter(containerId, videoId, playerVars = {}) {
  let ytPlayer = null;
  let readyCb = null;
  let stateChangeCb = null;
  let errorCb = null;
  let destroyed = false;

  const adapter = {
    // ------------------------------------------------------------------
    // Queries
    // ------------------------------------------------------------------
    getCurrentTime() {
      try { return ytPlayer?.getCurrentTime() ?? 0; } catch { return 0; }
    },

    getDuration() {
      try {
        const d = ytPlayer?.getDuration();
        return (typeof d === 'number' && d > 0) ? d : NaN;
      } catch { return NaN; }
    },

    getState() {
      try {
        const code = ytPlayer?.getPlayerState();
        return YT_STATE_MAP[code] ?? 'UNSTARTED';
      } catch { return 'UNSTARTED'; }
    },

    // ------------------------------------------------------------------
    // Commands
    // ------------------------------------------------------------------
    play() {
      try { ytPlayer?.playVideo(); } catch { /* swallow */ }
    },

    pause() {
      try { ytPlayer?.pauseVideo(); } catch { /* swallow */ }
    },

    seek(time) {
      try { ytPlayer?.seekTo(time, true); } catch { /* swallow */ }
    },

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------
    destroy() {
      if (destroyed) return;
      destroyed = true;
      readyCb = null;
      stateChangeCb = null;
      errorCb = null;
      try { ytPlayer?.destroy(); } catch { /* swallow */ }
      ytPlayer = null;
    },

    // ------------------------------------------------------------------
    // Event registration (call before player is ready)
    // ------------------------------------------------------------------
    onReady(cb) { readyCb = cb; },

    /**
     * Register a callback that is invoked ONLY for reportable state changes:
     *   'PLAYING' | 'PAUSED' | 'ENDED'
     * BUFFERING, CUED, and UNSTARTED are filtered out here so callers
     * never need to handle them.
     */
    onStateChange(cb) { stateChangeCb = cb; },

    onError(cb) { errorCb = cb; },
  };

  // Create the actual YT.Player.  window.YT must already be ready when this
  // function is called (the caller is responsible for that guard).
  ytPlayer = new window.YT.Player(containerId, {
    videoId,
    playerVars: {
      controls: 1,
      disablekb: 0,
      modestbranding: 1,
      rel: 0,
      enablejsapi: 1,
      origin: window.location.origin,
      playsinline: 1, // iOS inline playback
      ...playerVars,
    },
    events: {
      onReady: () => {
        if (!destroyed) readyCb?.();
      },
      onStateChange: (e) => {
        if (destroyed) return;
        const stateCode = e.data;
        // Only forward ENDED(0), PLAYING(1), PAUSED(2) to the callback.
        if (stateCode !== 0 && stateCode !== 1 && stateCode !== 2) return;
        const stateName = YT_STATE_MAP[stateCode];
        stateChangeCb?.(stateName);
      },
      onError: (e) => {
        if (!destroyed) errorCb?.(e);
      },
    },
  });

  return adapter;
}
