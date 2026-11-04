import { vi } from 'vitest';

// Used only by Vitest's alias; production keeps the existing Firebase CDN SDK.
export const ref = vi.fn((_database, path) => ({ path }));
export const onValue = vi.fn();
export const push = vi.fn();
export const set = vi.fn();
export const remove = vi.fn();
export const get = vi.fn();
export const onDisconnect = vi.fn();
export const update = vi.fn();
export const runTransaction = vi.fn();
export const serverTimestamp = vi.fn(() => 1000);
export const off = vi.fn();
