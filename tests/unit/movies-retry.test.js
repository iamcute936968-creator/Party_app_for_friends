import { expect, it } from 'vitest';
import { RETRY_DELAYS, RETRY_SPAN_MS, retryDelayMs } from '../../src/movies/retry';
it('paces nine user-facing attempts across roughly one minute', () => {
  expect(RETRY_DELAYS).toEqual([1200, 2400, 4000, 6500, 8000, 12000, 16000, 20000]);
  expect(RETRY_SPAN_MS).toBe(70100);
  expect(retryDelayMs(0)).toBe(1200);
  expect(retryDelayMs(7)).toBe(20000);
  expect(retryDelayMs(8)).toBe(-1); // exhausted → the error UI takes over
  expect(retryDelayMs(-1)).toBe(-1);
  expect(retryDelayMs('0')).toBe(-1);
});
