import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRoomAnimeStream } from '../../src/hooks/useRoomAnimeStream';
afterEach(cleanup);
const room = { id: 'ROOM', videoSource: 'anime', videoId: 'ap_naruto', animeEpisode: 1, mediaSelectionId: 'first' };
const stream = { sourceUrl: 'https://stream.animeparadise.moe/m3u8?url=private', subtitles: [] };
it('resolves a participant’s source locally and clears it when the room ends', async () => {
  const api = { details: vi.fn(async () => ({ id: 'ap_naruto', episodes: [] })), stream: vi.fn(async () => stream) };
  const { result, rerender } = renderHook(({ activeRoom }) => useRoomAnimeStream({ room: activeRoom, api }), { initialProps: { activeRoom: room } });
  await waitFor(() => expect(result.current.sourceUrl).toBe(stream.sourceUrl));
  expect(api.stream).toHaveBeenCalledWith('ap_naruto', 1, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  rerender({ activeRoom: null }); expect(result.current.sourceUrl).toBe('');
});
it('drops late old-episode responses and retries without mutating the room clock', async () => {
  let resolve; const api = { details: vi.fn(async () => ({ id: room.videoId, episodes: [] })),
    stream: vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(stream) };
  const { result, rerender } = renderHook(({ activeRoom }) => useRoomAnimeStream({ room: activeRoom, api }), { initialProps: { activeRoom: room } });
  await waitFor(() => expect(api.stream).toHaveBeenCalledTimes(1));
  rerender({ activeRoom: { ...room, animeEpisode: 2, mediaSelectionId: 'next' } });
  await waitFor(() => expect(result.current.sourceUrl).toBe(stream.sourceUrl));
  await act(async () => resolve({ ...stream, sourceUrl: 'https://stream.animeparadise.moe/m3u8?url=old' }));
  expect(result.current.sourceUrl).toBe(stream.sourceUrl);
  await act(async () => expect(await result.current.reload()).toBe(true));
  expect(api.stream.mock.calls.at(-1)[1]).toBe(2);
  expect(room).toEqual({ id: 'ROOM', videoSource: 'anime', videoId: 'ap_naruto', animeEpisode: 1, mediaSelectionId: 'first' });
});
