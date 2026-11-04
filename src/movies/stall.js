// Detects a stalled provider stream: the player reports "playing" but the
// reported position has not advanced for a while. Provider sources (VidSrc)
// occasionally stall on brand-new or high-demand titles; surfacing it lets the
// user reload or pick another title instead of staring at a frozen frame.
export const STALL_THRESHOLD_MS = 15000;
export function playbackStalled(previous, current, nowMs, thresholdMs = STALL_THRESHOLD_MS) {
  if (!previous || !current) return false;
  if (previous.position !== current.position) return false; // moving — healthy
  if (current.state !== 'playing') return false;            // paused/ended — not a stall
  return Number.isFinite(nowMs) && nowMs - previous.at >= thresholdMs;
}
