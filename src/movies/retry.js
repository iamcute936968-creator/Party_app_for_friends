// Retry pacing for user-initiated catalogue loads (search, filters, details).
// TMDB occasionally resets connections in multi-second windows; a patient,
// spaced schedule rides those out instead of failing in the same window.
// Total span ≈ 24s across 5 attempts; the media-proxy's upstream budget still
// caps the worst case, so this cannot turn into a request storm.
export const RETRY_DELAYS = [1200, 2400, 4000, 6500, 8000, 12000, 16000, 20000];
export function retryDelayMs(attempt) {
  return Number.isInteger(attempt) && attempt >= 0 && attempt < RETRY_DELAYS.length ? RETRY_DELAYS[attempt] : -1;
}
export const RETRY_SPAN_MS = RETRY_DELAYS.reduce((total, delay) => total + delay, 0);
