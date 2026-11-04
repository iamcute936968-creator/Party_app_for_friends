import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AnimePlayer from '../../src/components/AnimePlayer';
import { createYouTubeAdapter } from '../../src/adapters/YouTubeAdapter';
vi.mock('../../src/adapters/YouTubeAdapter', () => ({ createYouTubeAdapter: vi.fn() }));
const episode = { id: '2C7Kp0yBpvo', number: 1, embeddable: true, provider: 'Ani-One Asia', language: 'Japanese · Traditional Chinese subtitles' };
let player;
beforeEach(() => {
  player = { time: 0, getCurrentTime: () => player.time, getDuration: () => 100,
    seek: vi.fn(time => { player.time = time; }), play: vi.fn(), destroy: vi.fn(),
    onReady: next => { player.ready = next; }, onStateChange: next => { player.state = next; }, onError: next => { player.error = next; } };
  createYouTubeAdapter.mockReturnValue(player);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });
it('restores a bookmark, ignores startup pause and saves the real played position on exit', () => {
  const record = vi.fn();
  const library = { items: [{ source: 'youtube', id: episode.id, position: 40, completed: false }], record };
  const view = render(<AnimePlayer title="Camp" episode={episode} youtubeReady library={library} scope="guest" />);
  act(() => player.ready()); expect(player.seek).toHaveBeenCalledWith(40);
  act(() => { player.time = 0; player.state('PAUSED'); }); expect(record).not.toHaveBeenCalled();
  act(() => { player.time = 40; player.state('PLAYING'); });
  player.time = 45; view.unmount();
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ source: 'youtube', id: episode.id, position: 45, duration: 100 }));
  expect(player.destroy).toHaveBeenCalled();
});
it('never starts a known blocked source and provides the official alternative', () => {
  render(<AnimePlayer title="Hyouka" episode={{ ...episode, id: 'Ii7im-MQQ0A', embeddable: false }} youtubeReady />);
  expect(createYouTubeAdapter).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: /Open on YouTube/ }).getAttribute('href')).toBe('https://www.youtube.com/watch?v=Ii7im-MQQ0A');
});
it('closes failed players and ignores late callbacks after unmount', () => {
  const record = vi.fn(); const view = render(<AnimePlayer title="Camp" episode={episode} youtubeReady library={{ items: [], record }} />);
  act(() => player.error({ data: 150 }));
  expect(screen.getByRole('alert').textContent).toContain('YouTube');
  expect(player.destroy).toHaveBeenCalled(); view.unmount();
  act(() => { player.ready(); player.state('PLAYING'); }); expect(record).not.toHaveBeenCalled();
});

it('does not repeatedly write progress while playback is paused', () => {
  vi.useFakeTimers();
  const record = vi.fn(); let nativeState = 'PLAYING'; player.getState = () => nativeState;
  render(<AnimePlayer title="Camp" episode={episode} youtubeReady library={{ items: [], record }} />);
  act(() => { player.ready(); player.time = 10; player.state('PLAYING'); vi.advanceTimersByTime(10000); });
  expect(record).toHaveBeenCalledTimes(1);
  act(() => { nativeState = 'PAUSED'; player.state('PAUSED'); vi.advanceTimersByTime(30000); });
  expect(record).toHaveBeenCalledTimes(2);
});

it('offers the provider alternative if the native player never becomes ready', () => {
  vi.useFakeTimers();
  render(<AnimePlayer title="Camp" episode={episode} youtubeReady />);
  act(() => vi.advanceTimersByTime(12000));
  expect(screen.getByRole('alert').textContent).toContain('YouTube');
  expect(player.destroy).toHaveBeenCalled();
  act(() => player.ready());
  expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
});

it('waits for cloud history before initializing playback and restoring a bookmark', () => {
  const record = vi.fn();
  const view = render(<AnimePlayer title="Camp" episode={episode} youtubeReady library={{ items: [], cloudStatus: 'syncing', record }} />);
  expect(createYouTubeAdapter).not.toHaveBeenCalled();
  view.rerender(<AnimePlayer title="Camp" episode={episode} youtubeReady library={{ items: [{ source: 'youtube', id: episode.id, position: 40 }], cloudStatus: 'synced', record }} />);
  expect(createYouTubeAdapter).toHaveBeenCalledTimes(1);
  act(() => player.ready()); expect(player.seek).toHaveBeenCalledWith(40);
  expect(record).not.toHaveBeenCalled();
});

it('restores saved progress even when duration is not yet known at readiness', () => {
  player.getDuration = () => NaN;
  render(<AnimePlayer title="Camp" episode={episode} youtubeReady library={{ items: [{ source: 'youtube', id: episode.id, position: 40 }], record: vi.fn() }} />);
  act(() => player.ready()); expect(player.seek).toHaveBeenCalledWith(40);
});
