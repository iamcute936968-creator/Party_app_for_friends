import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Format seconds as MM:SS.
 */
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Navigation keys that constitute a seek gesture on a range input. */
const NAV_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown',
]);

/**
 * Drive Host Seek Timeline (Phase 6C).
 *
 * - Self-contained ~4Hz display tick via requestAnimationFrame.
 * - Reads video.currentTime and video.duration directly from driveVideoRef.
 * - Host: interactive <input type="range">.
 * - Member: disabled read-only progress bar.
 * - During host drag, a LOCAL dragValue overrides the displayed slider value.
 *   High-frequency drag state never leaves this component (S-03).
 * - Commit fires exactly once per completed gesture via explicit
 *   pointerup/pointercancel (pointer) or keyup (keyboard) — NOT via
 *   React's synthetic onChange, which fires continuously for range inputs (M-01).
 * - Drag ownership is tracked synchronously via refs (S-01).
 */
const DriveTimeline = React.memo(function DriveTimeline({
  driveVideoRef,
  mediaAdapter,
  isHost,
  onSeekStart,
  onSeekCommit,
  disabled,
}) {
  // Internal display state — updated at ~4Hz, isolated from App.jsx renders.
  const [displayTime, setDisplayTime] = useState(0);
  const [displayDuration, setDisplayDuration] = useState(NaN);
  const rafRef = useRef(null);

  // Local drag state — entirely self-contained (S-01, S-03).
  // dragValue is React state so it triggers re-renders for the slider thumb.
  // isDraggingRef is a ref for synchronous ownership checks in event handlers.
  const [dragValue, setDragValue] = useState(null);
  const isDraggingRef = useRef(false);
  const dragSourceRef = useRef(null); // 'pointer' | 'keyboard' | null
  const inputRef = useRef(null);
  const pointerCleanupRef = useRef(null);

  // ~4Hz display tick: read video element directly.
  // S-03 fix: removed the premature early return when driveVideoRef.current
  // is null on mount — the inner tick() already handles that safely.
  useEffect(() => {
    let lastUpdate = 0;

    const tick = (timestamp) => {
      const video = mediaAdapter ? { currentTime: mediaAdapter.getCurrentTime(), duration: mediaAdapter.getDuration() } : driveVideoRef?.current;
      if (video) {
        if (timestamp - lastUpdate > 250) {
          lastUpdate = timestamp;
          setDisplayTime(video.currentTime || 0);
          const d = video.duration;
          if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
            setDisplayDuration(d);
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [driveVideoRef, mediaAdapter]);

  // Cleanup document pointer listeners on unmount.
  useEffect(() => {
    return () => {
      if (pointerCleanupRef.current) {
        pointerCleanupRef.current();
        pointerCleanupRef.current = null;
      }
    };
  }, []);

  const hasDuration = Number.isFinite(displayDuration) && displayDuration > 0;
  const isDisabled = disabled || !hasDuration;

  // During host drag, show the drag position; otherwise show live time.
  const isDragging = dragValue !== null;
  const sliderValue = isDragging ? dragValue : displayTime;
  const sliderMax = hasDuration ? displayDuration : 1;

  // ------------------------------------------------------------------
  // Commit helper — reads final value from the DOM input element.
  // Called exactly once per completed gesture (pointer release or key up).
  // ------------------------------------------------------------------
  const commitSeek = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    dragSourceRef.current = null;
    const finalVal = inputRef.current
      ? parseFloat(inputRef.current.value)
      : null;
    setDragValue(null);
    if (finalVal !== null && Number.isFinite(finalVal)) {
      onSeekCommit?.(finalVal);
    }
  }, [onSeekCommit]);

  // ------------------------------------------------------------------
  // Pointer events (mouse + touch / iOS Safari)
  // Uses document-level pointerup/pointercancel to reliably detect
  // release even if the pointer leaves the slider element.
  // ------------------------------------------------------------------
  const handlePointerDown = useCallback(() => {
    if (isDraggingRef.current) return; // already tracking
    isDraggingRef.current = true;
    dragSourceRef.current = 'pointer';
    const val = inputRef.current ? parseFloat(inputRef.current.value) : 0;
    setDragValue(val);
    onSeekStart?.(val);

    // Listen on document for release — handles drags that end outside element.
    const onRelease = () => {
      document.removeEventListener('pointerup', onRelease, true);
      document.removeEventListener('pointercancel', onRelease, true);
      pointerCleanupRef.current = null;
      // Use rAF so the browser has applied the final input value.
      requestAnimationFrame(() => {
        commitSeek();
      });
    };
    // Remove any prior listener (safety).
    if (pointerCleanupRef.current) pointerCleanupRef.current();
    document.addEventListener('pointerup', onRelease, true);
    document.addEventListener('pointercancel', onRelease, true);
    pointerCleanupRef.current = () => {
      document.removeEventListener('pointerup', onRelease, true);
      document.removeEventListener('pointercancel', onRelease, true);
    };
  }, [onSeekStart, commitSeek]);

  // ------------------------------------------------------------------
  // React onChange — fires on every native input tick for range inputs.
  // Used ONLY for local visual preview; NEVER triggers commit (M-01).
  // ------------------------------------------------------------------
  const handleReactChange = useCallback((e) => {
    if (!isDraggingRef.current) return;
    const val = parseFloat(e.target.value);
    setDragValue(val);
  }, []);

  // ------------------------------------------------------------------
  // Keyboard events (ArrowLeft/Right, Home/End, PageUp/Down)
  // Single key press = start drag on keydown, commit on keyup.
  // Held key = start on first keydown, accumulate via onChange, commit on keyup.
  // ------------------------------------------------------------------
  const handleKeyDown = useCallback((e) => {
    if (!NAV_KEYS.has(e.key)) return;
    if (isDraggingRef.current) return; // key held down — already tracking
    isDraggingRef.current = true;
    dragSourceRef.current = 'keyboard';
    const val = inputRef.current ? parseFloat(inputRef.current.value) : 0;
    setDragValue(val);
    onSeekStart?.(val);
  }, [onSeekStart]);

  const handleKeyUp = useCallback((e) => {
    if (!NAV_KEYS.has(e.key)) return;
    if (dragSourceRef.current !== 'keyboard') return;
    // Use rAF so React/browser has applied the value change from the key press.
    requestAnimationFrame(() => {
      commitSeek();
    });
  }, [commitSeek]);

  // Progress percentage for the track fill.
  const progress = hasDuration
    ? (sliderValue / displayDuration) * 100
    : 0;

  return (
    <div className="drive-timeline flex items-center gap-3 px-3 py-2 select-none"
         style={{ minHeight: 36 }}>
      {/* Elapsed time */}
      <span className="text-gray-400 text-xs font-mono w-12 text-right flex-shrink-0">
        {hasDuration ? formatTime(sliderValue) : '--:--'}
      </span>

      {/* Range slider */}
      <div className="relative flex-1 flex items-center" style={{ height: 20 }}>
        <input
          ref={inputRef}
          type="range"
          min={0}
          max={sliderMax}
          step={0.1}
          value={isDisabled ? 0 : sliderValue}
          onPointerDown={isHost && !isDisabled ? handlePointerDown : undefined}
          onChange={isHost && !isDisabled ? handleReactChange : undefined}
          onKeyDown={isHost && !isDisabled ? handleKeyDown : undefined}
          onKeyUp={isHost && !isDisabled ? handleKeyUp : undefined}
          disabled={!isHost || isDisabled}
          aria-label="Video timeline"
          aria-valuemin={0}
          aria-valuemax={sliderMax}
          aria-valuenow={isDisabled ? 0 : sliderValue}
          aria-valuetext={hasDuration ? formatTime(sliderValue) : 'No video loaded'}
          className="drive-timeline-slider"
          style={{
            width: '100%',
            height: 4,
            appearance: 'none',
            WebkitAppearance: 'none',
            background: isDisabled
              ? '#374151'
              : `linear-gradient(to right, var(--accent) 0%, var(--accent) ${progress}%, var(--line) ${progress}%, var(--line) 100%)`,
            borderRadius: 2,
            outline: 'none',
            cursor: isHost && !isDisabled ? 'pointer' : 'default',
            opacity: isDisabled ? 0.4 : 1,
          }}
        />
      </div>

      {/* Total duration */}
      <span className="text-gray-400 text-xs font-mono w-12 flex-shrink-0">
        {hasDuration ? formatTime(displayDuration) : '--:--'}
      </span>
    </div>
  );
});

export default DriveTimeline;
