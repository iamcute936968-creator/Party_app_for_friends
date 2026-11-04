import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRoomInvite, parseRoomInvite } from '../../src/invites/roomInvite';
import { useRoomInvite } from '../../src/hooks/useRoomInvite';

const base = 'https://party.example/watch?old=value#fragment';
const pending = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const copyText = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  copyText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText: copyText } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('invite URL handling', () => {
  it('builds a canonical link that round-trips encoded secrets and removes unrelated URL state', () => {
    const result = buildRoomInvite(base, 'ROOM_A', 'private + &/#?');
    const parsed = new URL(result);
    expect(parsed.origin + parsed.pathname).toBe('https://party.example/watch');
    expect([...parsed.searchParams.keys()]).toEqual(['room', 's']);
    expect(parsed.hash).toBe('');
    expect(parseRoomInvite(result)).toEqual({ roomId: 'ROOM_A', secret: 'private + &/#?' });
    expect(new URL(buildRoomInvite(base, 'ROOM_A', '')).searchParams.has('s')).toBe(false);
  });
  it('supports room codes, full invite links and legacy query strings', () => {
    expect(parseRoomInvite('  room_a  ')).toEqual({ roomId: 'ROOM_A' });
    expect(parseRoomInvite('?room=room_a&s=key')).toEqual({ roomId: 'ROOM_A', secret: 'key' });
    expect(parseRoomInvite('https://party.example/?room=ROOM_A')).toEqual({ roomId: 'ROOM_A', secret: '' });
  });
  it('rejects malformed links and invalid Firebase room path characters', () => {
    for (const value of ['', 'https://', 'https://party.example/', 'javascript:alert(1)', 'ROOM/OTHER', 'ROOM.#', 'https://party.example/?room=ROOM%2FOTHER', null]) {
      expect(parseRoomInvite(value)).toBeNull();
    }
    expect(buildRoomInvite('javascript:alert(1)', 'ROOM_A', 'key')).toBe('');
  });
});

describe('invite sharing lifecycle', () => {
  it('waits for clipboard confirmation, blocks duplicate clicks and resets confirmed feedback', async () => {
    const job = pending(); copyText.mockReturnValueOnce(job.promise);
    const { result } = renderHook(() => useRoomInvite('ROOM_A', 'key', base));
    let sending;
    act(() => { sending = result.current.copy(); void result.current.copy(); });
    expect(result.current.status).toBe('copying');
    expect(copyText).toHaveBeenCalledOnce();
    await act(async () => { job.resolve(); await sending; });
    expect(result.current.status).toBe('copied');
    expect(copyText).toHaveBeenCalledWith(buildRoomInvite(base, 'ROOM_A', 'key'));
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.status).toBe('idle');
  });
  it('offers manual copy after rejected or unavailable clipboard access without leaking provider errors', async () => {
    copyText.mockRejectedValueOnce(new Error('private permission details'));
    const { result } = renderHook(() => useRoomInvite('ROOM_A', 'key', base));
    await act(async () => result.current.copy());
    expect(result.current.status).toBe('manual');
    expect(result.current.error).toBe('Could not copy the invite. Copy the link below.');
    expect(result.current.url).toBe(buildRoomInvite(base, 'ROOM_A', 'key'));
    vi.stubGlobal('navigator', {});
    await act(async () => result.current.copy());
    expect(result.current.status).toBe('manual');
  });
  it('invokes native sharing directly and treats cancellation as a quiet result', async () => {
    const share = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce({ name: 'AbortError' });
    vi.stubGlobal('navigator', { share, clipboard: { writeText: copyText } });
    const { result } = renderHook(() => useRoomInvite('ROOM_A', 'key', base));
    let sending;
    act(() => { sending = result.current.share(); expect(share).toHaveBeenCalledOnce(); });
    await act(async () => sending);
    expect(share).toHaveBeenCalledWith({ title: 'Watch Party', url: buildRoomInvite(base, 'ROOM_A', 'key') });
    await act(async () => result.current.share());
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBe('');
    expect(copyText).not.toHaveBeenCalled();
  });
  it('falls back to copy when native sharing is missing and manual copy when sharing fails', async () => {
    const { result } = renderHook(() => useRoomInvite('ROOM_A', '', base));
    await act(async () => result.current.share());
    expect(result.current.status).toBe('copied');
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new Error('private target detail')) });
    await act(async () => result.current.share());
    expect(result.current.status).toBe('manual');
    expect(result.current.error).toBe('Could not share the invite. Copy the link below.');
  });
  it('isolates late acknowledgements and timers across room changes, unmount and StrictMode', async () => {
    const job = pending(); copyText.mockReturnValueOnce(job.promise);
    const { result, rerender, unmount } = renderHook(({ id }) => useRoomInvite(id, 'key', base), { initialProps: { id: 'ROOM_A' }, reactStrictMode: true });
    let sending;
    act(() => { sending = result.current.copy(); });
    rerender({ id: 'ROOM_B' });
    await act(async () => { job.resolve(); await sending; });
    expect(result.current.status).toBe('idle');
    expect(parseRoomInvite(result.current.url).roomId).toBe('ROOM_B');
    await act(async () => result.current.copy());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not act outside a room or let an old feedback timer clear a newer pending share', async () => {
    const { result, rerender } = renderHook(({ id }) => useRoomInvite(id, '', base), { initialProps: { id: null } });
    await act(async () => result.current.copy());
    expect(copyText).not.toHaveBeenCalled();
    rerender({ id: 'ROOM_A' });
    await act(async () => result.current.copy());
    const job = pending(); vi.stubGlobal('navigator', { share: vi.fn(() => job.promise) });
    let sending;
    act(() => { sending = result.current.share(); vi.advanceTimersByTime(2000); });
    expect(result.current.status).toBe('sharing');
    await act(async () => { job.resolve(); await sending; });
  });
});
