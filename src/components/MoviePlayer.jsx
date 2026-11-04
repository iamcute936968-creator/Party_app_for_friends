import { useEffect, useMemo, useRef, useState } from 'react';
import { movieEmbedUrl, movieSelection, parseMoviePlayerEvent } from '../movies/selection';
import { cineSrcEmbedUrl } from '../adapters/CineSrcAdapter';
import { STALL_THRESHOLD_MS, playbackStalled } from '../movies/stall';

const EMPTY = { items: [], status: 'guest' };

export default function MoviePlayer({ item, selection, library = EMPTY }) {
  const frame = useRef(null), [attempt, setAttempt] = useState(0), [status, setStatus] = useState('loading'), [saveError, setSaveError] = useState(''), [waitingAttempt, setWaitingAttempt] = useState(null), [stalled, setStalled] = useState(false);
  const [provider, setProvider] = useState('cinesrc');
  const { kind, id, season, episode } = selection;
  const target = useMemo(() => movieSelection({ kind, id, season, episode }, true), [kind, id, season, episode]);
  const [resume] = useState(() => library.items.find(entry => entry.kind === kind && entry.id === id && !entry.completed && (kind === 'movie' || (entry.season === season && entry.episode === episode)))?.position || 0);
  const source = provider === 'cinesrc' ? cineSrcEmbedUrl(target, resume) : movieEmbedUrl(target, resume);
  const record = library.record, libraryStatus = library.status, imdb = item.externalIds?.imdb || '';

  useEffect(() => {
    let active = true, latest = null, lastSaved = null, lastSavedAt = 0, move = null;
    const responseTimer = setTimeout(() => { if (active) setWaitingAttempt(attempt); }, 15000);
    const save = progress => {
      if (!record || ['syncing', 'error'].includes(libraryStatus)) return;
      lastSaved = progress.position; lastSavedAt = Date.now();
      try {
        Promise.resolve(record({ kind, id, title: item.title, season: target.season, episode: target.episode, position: progress.position, duration: progress.duration, completed: progress.completed }))
          .catch(() => { if (active) setSaveError('Your last watch position could not be saved.'); });
      } catch {
        if (active) setSaveError('Your last watch position could not be saved.');
      }
    };
    const receive = event => {
      if (event.source !== frame.current?.contentWindow) return;

      if (event.origin === 'https://cinesrc.st' && typeof event.data?.type === 'string' && event.data.type.startsWith('cinesrc:')) {
        const data = event.data;
        clearTimeout(responseTimer);
        setWaitingAttempt(null);
        if (data.type === 'cinesrc:ready') {
          setStatus('ready');
        } else if (data.type === 'cinesrc:timeupdate' || data.type === 'cinesrc:seeked') {
          if (Number.isFinite(data.currentTime)) {
            const progress = {
              kind,
              id,
              status: 'playing',
              position: Math.round(data.currentTime),
              duration: Number.isFinite(data.duration) ? Math.round(data.duration) : 0,
              completed: Boolean(data.duration && data.currentTime >= data.duration - 2)
            };
            setStatus('playing');
            latest = progress;
            if (Date.now() - lastSavedAt >= 10000) save(progress);
          }
        } else if (data.type === 'cinesrc:play') {
          setStatus('playing');
        } else if (data.type === 'cinesrc:pause') {
          setStatus('paused');
          if (latest) save(latest);
        } else if (data.type === 'cinesrc:ended') {
          setStatus('completed');
          if (latest) save({ ...latest, completed: true });
        } else if (data.type === 'cinesrc:error') {
          setStatus('error');
        }
        return;
      }

      const progress = parseMoviePlayerEvent(event, { frame: frame.current?.contentWindow, selection: target, imdb });
      if (!progress) return;
      clearTimeout(responseTimer); setWaitingAttempt(null);
      if (progress.error) { setStatus('error'); return; }
      setStatus(progress.status); latest = progress;
      if (progress.status === 'playing') {
        if (!move || Math.abs(progress.position - move.position) > 1) { move = { position: progress.position, at: Date.now() }; setStalled(false); }
        else if (playbackStalled(move, progress, Date.now())) setStalled(true);
      }
      if (progress.status !== 'playing' || Date.now() - lastSavedAt >= 10000) save(progress);
    };
    window.addEventListener('message', receive);
    return () => {
      active = false;
      clearTimeout(responseTimer);
      window.removeEventListener('message', receive);
      if (latest && latest.position !== lastSaved) save(latest);
    };
  }, [target, kind, id, imdb, item.title, record, libraryStatus, attempt]);

  return <section className="movie-player" aria-label="Movie player">
    <div className="movie-player-frame">
      {status !== 'error' && source && <iframe key={`${provider}/${attempt}`} ref={frame} src={source} title={`${item.title} player`}
        sandbox={provider === 'cinesrc' ? 'allow-scripts allow-same-origin' : undefined}
        allow="autoplay; fullscreen; picture-in-picture; screen-wake-lock" allowFullScreen referrerPolicy="origin"
        onLoad={() => setStatus(old => old === 'loading' ? 'ready' : old)} onError={() => setStatus('error')} />}
      {status === 'error' && <div className="movie-player-error" role="alert"><p>This title or episode is unavailable in the player right now.</p><button className="room-button room-button-secondary" type="button" onClick={() => { setStatus('loading'); setAttempt(value => value + 1); }}>Retry player</button></div>}
    </div>
    <div className="movie-player-status"><p role="status">{status === 'loading' ? 'Loading player...' : status === 'ready' ? 'Press Play in the player to start watching.' : status === 'error' ? 'Choose another title or retry.' : status === 'playing' ? 'Playing' : status === 'completed' ? 'Finished' : status === 'paused' ? 'Paused' : 'Watch position updated.'}</p>
      {status !== 'error' && <button className="room-button room-button-quiet" type="button" onClick={() => { setStalled(false); setStatus('loading'); setAttempt(value => value + 1); }}>Reload player</button>}
      <button className="room-button room-button-quiet" type="button" onClick={() => { setStatus('loading'); setProvider(p => p === 'cinesrc' ? 'vidsrc' : 'cinesrc'); }}>Switch source ({provider === 'cinesrc' ? 'VidSrc' : 'CineSrc'})</button>
    </div>
    <p className="movie-provider-note">Player provided by {provider === 'cinesrc' ? 'CineSrc' : 'VidSrc'}. Availability varies by title and region.</p>
    {status !== 'error' && waitingAttempt === attempt && <p className="anime-notice" role="status">The video provider is taking longer to respond. If the player stays blank or keeps buffering, use Reload player, switch source, or check your network/VPN connection.</p>}
    {stalled && status === 'playing' && <p className="anime-notice" role="status">The stream seems frozen at this position. Use Reload player or switch source — brand-new releases sometimes have slow sources.</p>}
    {saveError && <p className="anime-notice" role="status">{saveError}</p>}
  </section>;
}
