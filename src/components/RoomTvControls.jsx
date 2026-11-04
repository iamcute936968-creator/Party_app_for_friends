import { useEffect, useMemo, useRef, useState } from 'react';
import { createMovieApi } from '../movies/api';
import { movieRoomScope, movieRoomSelection } from '../movies/room';

const ordered = (items, min) => [...new Map((Array.isArray(items) ? items : [])
  .filter(item => Number.isInteger(item?.number) && item.number >= min && item.number <= 9999)
  .map(item => [item.number, item])).values()].sort((a, b) => a.number - b.number);

function TvControls({ room, isHost, disabled, onSelect, service }) {
  const [previewSeason, setPreviewSeason] = useState(room.movieSeason);
  const [retry, setRetry] = useState(0);
  const [metadata, setMetadata] = useState({ loading: true, error: '', seasons: [], episodes: [], season: null });
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const cached = useRef(new Map());
  const action = useRef(null);
  const latest = useRef(null);
  latest.current = { allowed: isHost && !disabled, onSelect };

  useEffect(() => {
    const controller = new AbortController();
    setMetadata(value => ({ ...value, loading: true, error: '' }));
    (async () => {
      try {
        const [details, season] = await Promise.all([
          service.details('tv', room.videoId, { signal: controller.signal }),
          service.season(room.videoId, previewSeason, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        const episodes = ordered(season.episodes, 1);
        cached.current.set(previewSeason, episodes);
        setMetadata({ loading: false, error: '', seasons: ordered(details.seasons, 0), episodes, season: previewSeason });
      } catch {
        if (!controller.signal.aborted) setMetadata(value => ({ ...value, loading: false, error: 'TV details could not be loaded. Please try again.' }));
      }
    })();
    return () => controller.abort();
  }, [service, room.videoId, previewSeason, retry]);

  useEffect(() => () => { action.current?.abort(); action.current = null; }, []);
  useEffect(() => {
    if (!isHost || disabled) { action.current?.abort(); action.current = null; setPending(false); }
  }, [isHost, disabled]);

  const seasons = metadata.seasons;
  const seasonIndex = seasons.findIndex(item => item.number === room.movieSeason);
  const currentEpisodes = cached.current.get(room.movieSeason) || [];
  const episodeIndex = currentEpisodes.findIndex(item => item.number === room.movieEpisode);
  const blocked = !isHost || disabled || pending || metadata.loading || Boolean(metadata.error) || metadata.season !== previewSeason;
  const run = async resolve => {
    if (blocked || action.current) return;
    const controller = new AbortController(); action.current = controller;
    setPending(true); setActionError('');
    try {
      const choice = await resolve(controller.signal);
      if (controller.signal.aborted || action.current !== controller || !latest.current.allowed) return;
      if (!choice) throw new Error('No episode');
      await latest.current.onSelect?.({ source: 'movie', kind: 'tv', id: room.videoId, title: room.movieTitle, ...choice });
    } catch {
      if (!controller.signal.aborted && action.current === controller) setActionError('That TV episode could not be selected. Please try again.');
    } finally {
      if (action.current === controller) { action.current = null; setPending(false); }
    }
  };
  const adjacent = direction => run(async signal => {
    const episode = currentEpisodes[episodeIndex + direction];
    if (episode) return { season: room.movieSeason, episode: episode.number };
    const target = seasons[seasonIndex + direction];
    if (!target) return null;
    const result = await service.season(room.videoId, target.number, { signal });
    const episodes = ordered(result.episodes, 1);
    const next = direction > 0 ? episodes[0] : episodes.at(-1);
    return next ? { season: target.number, episode: next.number } : null;
  });
  const previous = episodeIndex >= 0 && (episodeIndex > 0 || seasonIndex > 0);
  const next = episodeIndex >= 0 && (episodeIndex < currentEpisodes.length - 1 || (seasonIndex >= 0 && seasonIndex < seasons.length - 1));
  const selectedEpisode = previewSeason === room.movieSeason ? room.movieEpisode : '';

  return <div className="room-tv-controls" role="group" aria-label="TV episode navigation">
    <label>TV season<select value={previewSeason} disabled={blocked} onChange={event => {
      if (!blocked && seasons.some(item => item.number === Number(event.target.value))) { setPreviewSeason(Number(event.target.value)); setActionError(''); }
    }}>{seasons.map(item => <option key={item.number} value={item.number}>{item.name || `Season ${item.number}`}</option>)}</select></label>
    <label>TV episode<select value={selectedEpisode} disabled={blocked || metadata.episodes.length === 0} onChange={event => {
      const episode = metadata.episodes.find(item => item.number === Number(event.target.value));
      if (episode) void run(async () => ({ season: previewSeason, episode: episode.number }));
    }}><option value="">Choose an episode</option>{metadata.episodes.map(item => <option key={item.number} value={item.number}>
      Episode {item.number}{item.title ? ` — ${item.title}` : ''}</option>)}</select></label>
    <button type="button" className="room-button room-button-secondary" disabled={blocked || !previous} onClick={() => void adjacent(-1)}>Previous TV episode</button>
    <button type="button" className="room-button room-button-secondary" disabled={blocked || !next} onClick={() => void adjacent(1)}>Next TV episode</button>
    {metadata.loading && <p role="status">Loading TV episodes...</p>}
    {(metadata.error || actionError) && <div><p role="alert">{metadata.error || actionError}</p>
      <button type="button" className="room-button room-button-secondary" disabled={disabled || pending} onClick={() => { setActionError(''); setRetry(value => value + 1); }}>Retry TV details</button></div>}
  </div>;
}

export default function RoomTvControls({ room, isHost, disabled = false, onSelect, proxyUrl = import.meta.env.VITE_MEDIA_PROXY_URL || '', api }) {
  const service = useMemo(() => api || createMovieApi({ proxyUrl }), [api, proxyUrl]);
  const selection = movieRoomSelection(room), scope = movieRoomScope(room);
  return scope && selection?.kind === 'tv' ? <TvControls key={scope} room={room} isHost={isHost} disabled={disabled} onSelect={onSelect} service={service} /> : null;
}
