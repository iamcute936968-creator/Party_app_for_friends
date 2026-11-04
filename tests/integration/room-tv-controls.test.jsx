import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RoomTvControls from '../../src/components/RoomTvControls';

afterEach(cleanup);
const room = { id: 'ROOM', mediaSelectionId: 'first', videoSource: 'movie', movieKind: 'tv', videoId: '46260', movieTitle: 'Naruto', movieSeason: 2, movieEpisode: 4 };
const season = (number, numbers) => ({ showId: '46260', number, episodes: numbers.map(value => ({ number: value, title: `Story ${value}` })) });
const service = () => ({
  details: vi.fn(async () => ({ id: '46260', mediaKind: 'tv', seasons: [{ number: 5, name: 'Later' }, { number: 0, name: 'Specials' }, { number: 2, name: 'Current' }] })),
  season: vi.fn(async (_id, number) => season(number, number === 0 ? [9, 1] : number === 5 ? [8, 3] : [9, 1, 4])),
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

describe('RoomTvControls component units', () => {
  it('does not fetch or render controls for other sources or movies', () => {
    const api = service(), view = render(<RoomTvControls room={{ ...room, movieKind: 'movie' }} isHost api={api} />);
    view.rerender(<RoomTvControls room={{ ...room, videoSource: 'anime' }} isHost api={api} />);
    expect(api.details).not.toHaveBeenCalled(); expect(api.season).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('TV season')).toBeNull();
  });

  it('loads normalized metadata, previews seasons and selects only a chosen episode', async () => {
    const api = service(), onSelect = vi.fn();
    render(<RoomTvControls room={room} isHost api={api} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByLabelText('TV episode').disabled).toBe(false));
    expect(api.details).toHaveBeenCalledWith('tv', '46260', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(Array.from(screen.getByLabelText('TV season').options).map(item => item.value)).toEqual(['0', '2', '5']);
    fireEvent.change(screen.getByLabelText('TV season'), { target: { value: '5' } });
    await waitFor(() => expect(screen.getByLabelText('TV episode').options).toHaveLength(3));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('TV episode'), { target: { value: '8' } });
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ source: 'movie', kind: 'tv', id: '46260', title: 'Naruto', season: 5, episode: 8 }));
    expect(document.querySelector('iframe, video')).toBeNull();
  });

  it('uses actual sorted episode numbers for previous and next', async () => {
    const api = service(), onSelect = vi.fn();
    render(<RoomTvControls room={room} isHost api={api} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next TV episode' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Next TV episode' }));
    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ season: 2, episode: 9 })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous TV episode' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Previous TV episode' }));
    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ season: 2, episode: 1 })));
  });

  it('fetches adjacent actual seasons at episode boundaries', async () => {
    const api = service(), onSelect = vi.fn(), view = render(<RoomTvControls room={{ ...room, movieEpisode: 9 }} isHost api={api} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next TV episode' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Next TV episode' }));
    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ season: 5, episode: 3 })));
    expect(api.season).toHaveBeenCalledWith('46260', 5, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    view.rerender(<RoomTvControls room={{ ...room, movieEpisode: 1 }} isHost api={api} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous TV episode' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Previous TV episode' }));
    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ season: 0, episode: 9 })));
  });

  it('gates member, disconnected and pending transport without changing playback', async () => {
    const api = service(), onSelect = vi.fn(), view = render(<RoomTvControls room={room} isHost={false} api={api} onSelect={onSelect} />);
    await waitFor(() => expect(api.season).toHaveBeenCalled());
    for (const control of [...screen.getAllByRole('button'), ...screen.getAllByRole('combobox')]) expect(control.disabled).toBe(true);
    view.rerender(<RoomTvControls room={room} isHost api={api} onSelect={onSelect} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Next TV episode' }));
    expect(onSelect).not.toHaveBeenCalled();
    view.rerender(<RoomTvControls room={room} isHost api={api} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByLabelText('TV episode').disabled).toBe(false));
    const pending = deferred(); onSelect.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Next TV episode' }));
    await waitFor(() => expect(screen.getByLabelText('TV episode').disabled).toBe(true));
    await act(async () => pending.resolve());
    await waitFor(() => expect(screen.getByLabelText('TV episode').disabled).toBe(false));
  });

  it('retries failed metadata without selecting or creating a player', async () => {
    const api = service(), onSelect = vi.fn(); api.details.mockRejectedValueOnce(Error('provider failed'));
    render(<RoomTvControls room={room} isHost api={api} onSelect={onSelect} />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry TV details' }));
    await waitFor(() => expect(screen.getByLabelText('TV episode').disabled).toBe(false));
    expect(api.details).toHaveBeenCalledTimes(2); expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelector('iframe, video')).toBeNull();
  });
});

describe('RoomTvControls asynchronous integration', () => {
  it('ignores cancelled adjacent-season responses after the room media changes', async () => {
    const api = service(), pending = deferred(), onSelect = vi.fn();
    api.season.mockImplementation(async (_id, number) => number === 5 ? pending.promise : season(number, [1, 4, 9]));
    const view = render(<RoomTvControls room={{ ...room, movieEpisode: 9 }} isHost api={api} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next TV episode' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Next TV episode' }));
    await waitFor(() => expect(api.season).toHaveBeenCalledWith('46260', 5, expect.anything()));
    const oldSignal = api.season.mock.calls.find(call => call[1] === 5)[2].signal;
    view.rerender(<RoomTvControls room={{ ...room, mediaSelectionId: 'replacement' }} isHost api={api} onSelect={onSelect} />);
    expect(oldSignal.aborted).toBe(true);
    await act(async () => pending.resolve(season(5, [3])));
    expect(onSelect).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('TV episode').disabled).toBe(false));
    expect(screen.getByLabelText('TV episode').value).toBe('4');
  });

  it('ignores stale metadata after source changes and cancels on loss of host authority', async () => {
    const api = service(), pending = deferred(), onSelect = vi.fn(); api.details.mockReturnValueOnce(pending.promise);
    const view = render(<RoomTvControls room={room} isHost api={api} onSelect={onSelect} />);
    view.rerender(<RoomTvControls room={{ ...room, videoSource: 'anime' }} isHost api={api} onSelect={onSelect} />);
    expect(api.details.mock.calls[0][2].signal.aborted).toBe(true);
    await act(async () => pending.resolve({ seasons: [{ number: 99 }] }));
    expect(screen.queryByLabelText('TV season')).toBeNull();
    const next = deferred(); api.season.mockImplementation(async (_id, number) => number === 5 ? next.promise : season(number, [9]));
    view.rerender(<RoomTvControls room={{ ...room, movieEpisode: 9 }} isHost api={api} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next TV episode' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Next TV episode' }));
    const nextSignal = api.season.mock.calls.find(call => call[1] === 5)[2].signal;
    view.rerender(<RoomTvControls room={{ ...room, movieEpisode: 9 }} isHost={false} api={api} onSelect={onSelect} />);
    expect(nextSignal.aborted).toBe(true);
    await act(async () => next.resolve(season(5, [3])));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('cancels an old preview season when shared selection changes', async () => {
    const api = service(), pending = deferred(), onSelect = vi.fn();
    api.season.mockImplementation(async (_id, number) => number === 5 ? pending.promise : season(number, [1, 4, 9]));
    const view = render(<RoomTvControls room={room} isHost api={api} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByLabelText('TV season').disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('TV season'), { target: { value: '5' } });
    await waitFor(() => expect(api.season).toHaveBeenCalledWith('46260', 5, expect.anything()));
    const oldSignal = api.season.mock.calls.find(call => call[1] === 5)[2].signal;
    view.rerender(<RoomTvControls room={{ ...room, movieSeason: 0, movieEpisode: 9 }} isHost api={api} onSelect={onSelect} />);
    expect(oldSignal.aborted).toBe(true);
    await act(async () => pending.resolve(season(5, [3, 8])));
    await waitFor(() => expect(screen.getByLabelText('TV episode').disabled).toBe(false));
    expect(screen.getByLabelText('TV season').value).toBe('0');
    expect(screen.getByLabelText('TV episode').value).toBe('9');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
