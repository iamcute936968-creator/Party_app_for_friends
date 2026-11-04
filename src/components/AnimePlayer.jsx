import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, Play } from 'lucide-react';
import { createYouTubeAdapter } from '../adapters/YouTubeAdapter';

const validVideo = id => typeof id === 'string' && /^[\w-]{11}$/.test(id);
export default function AnimePlayer({ title, episode, youtubeReady = false, library, scope = 'guest' }) {
  const host = useRef(null), current = useRef(null), latestLibrary = useRef(library);
  latestLibrary.current = library;
  const mountId = `anime-player-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [state, setState] = useState({ ready: false, error: '' });
  const videoId = episode?.id, embeddable = episode?.embeddable === true;
  const allowed = validVideo(videoId) && embeddable;
  const progressReady = library?.cloudStatus !== 'syncing';
  useEffect(() => {
    if (!allowed || !progressReady) return;
    if (!youtubeReady) {
      const timer = setTimeout(() => setState({ ready: false, error: 'The YouTube player could not load. Open the video on YouTube to continue.' }), 12000);
      return () => clearTimeout(timer);
    }
    let active = true, ready = false, started = false, failed = false, restoring = false, bookmark = 0;
    let lastSaved = Date.now();
    const record = latestLibrary.current?.record;
    const placeholder = document.createElement('div'); placeholder.id = mountId;
    host.current.replaceChildren(placeholder);
    const adapter = createYouTubeAdapter(mountId, videoId, { autoplay: 0 });
    current.current = adapter;
    setState({ ready: false, error: '' });
    const readinessTimer = setTimeout(() => {
      if (!active || ready || failed) return;
      failed = true; adapter.destroy();
      setState({ ready: false, error: 'The YouTube player could not load. Open the video on YouTube to continue.' });
    }, 12000);
    const updateRestore = time => { if (restoring && Math.abs(time - bookmark) <= 3) restoring = false; };
    const save = () => {
      if (!ready || !started || failed || typeof record !== 'function') return;
      const time = adapter.getCurrentTime(), duration = adapter.getDuration();
      updateRestore(time);
      if (restoring || !Number.isFinite(time) || time < 0 || !Number.isFinite(duration) || duration <= 0) return;
      // Capture this account's record action, never a replacement account's action.
      try { Promise.resolve(record({ source: 'youtube', id: videoId, title: `${title} · Episode ${episode.number}`, position: time, duration })).catch(() => {}); }
      catch { /* The shared library exposes persistence failures to the user. */ }
      lastSaved = Date.now();
    };
    adapter.onReady(() => {
      if (!active || failed) return;
      clearTimeout(readinessTimer);
      ready = true;
      const saved = latestLibrary.current?.items?.find(item => item.source === 'youtube' && item.id === videoId);
      const duration = adapter.getDuration();
      bookmark = saved && !saved.completed && saved.position > 0 && (!Number.isFinite(duration) || saved.position < duration) ? saved.position : 0;
      restoring = bookmark > 0;
      if (restoring) adapter.seek(bookmark);
      setState({ ready: true, error: '' });
    });
    adapter.onStateChange(state => {
      if (!active || !ready || failed) return;
      updateRestore(adapter.getCurrentTime());
      if (state === 'PLAYING') started = true;
      else if (state === 'PAUSED' || state === 'ENDED') save();
    });
    adapter.onError(() => {
      if (!active || failed) return;
      clearTimeout(readinessTimer);
      save(); failed = true; adapter.destroy();
      setState({ ready: false, error: 'This video cannot play here. Open it on YouTube to check availability in your region.' });
    });
    const timer = setInterval(() => {
      if (!active || !ready || failed) return;
      updateRestore(adapter.getCurrentTime());
      if (adapter.getState?.() === 'PLAYING' && Date.now() - lastSaved >= 10000) save();
    }, 1000);
    const visibility = () => { if (document.hidden) save(); };
    window.addEventListener('pagehide', save); document.addEventListener('visibilitychange', visibility);
    return () => {
      active = false; save(); clearInterval(timer); clearTimeout(readinessTimer);
      window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', visibility);
      adapter.destroy(); if (current.current === adapter) current.current = null;
    };
  }, [allowed, progressReady, videoId, youtubeReady, scope, mountId, title, episode?.number]);

  return <section className="anime-player" aria-label={`${title} player`}>
    {allowed ? <>
      <div className="anime-player-frame" ref={host} />
      {state.error ? <p className="anime-notice" role="alert">{state.error}</p>
        : <div className="anime-player-controls"><button className="room-button room-button-primary" type="button" disabled={!state.ready}
          onClick={() => current.current?.play()}><Play aria-hidden="true" />{state.ready ? 'Play video' : 'Preparing player…'}</button>
          {library && <p>{library.cloudError || (library.cloudStatus === 'syncing' ? 'Loading your saved progress...'
            : library.persistent === false && library.cloudStatus === 'guest' ? 'Progress is kept for this session only.' : 'Episode progress is saved to your Library.')}</p>}</div>}
    </> : <p className="anime-notice">This source supports watching on its official YouTube page.</p>}
    {validVideo(videoId) && <a className="anime-external" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer">
      Open on YouTube <ExternalLink aria-hidden="true" /></a>}
  </section>;
}
