import { useEffect, useRef, useState } from 'react';
import { attachAnimeHls } from '../anime/hls';

export default function ParadisePlayer({ api, animeId, title, episode }) {
  const video = useRef(null);
  const [retry, setRetry] = useState(0), [state, setState] = useState({ ready: false, error: false, subtitles: [] });
  useEffect(() => {
    let active = true, release, timer;
    const controller = new AbortController();
    setState({ ready: false, error: false, subtitles: [] });
    const fail = () => { if (active) { clearTimeout(timer); setState(old => ({ ...old, ready: false, error: true })); release?.(); release = null; controller.abort(); } };
    timer = setTimeout(fail, 40000);
    Promise.resolve().then(() => api.stream(animeId, episode.number, { signal: controller.signal })).then(async data => {
      if (!active || controller.signal.aborted) return;
      setState({ ready: false, error: false, subtitles: data.subtitles });
      const stop = await attachAnimeHls(video.current, data.sourceUrl, { onError: fail, signal: controller.signal });
      if (!active || controller.signal.aborted) stop(); else release = stop;
    }).catch(() => { if (!controller.signal.aborted) fail(); });
    const ready = () => { if (active && !controller.signal.aborted) { clearTimeout(timer); setState(old => ({ ...old, ready: true })); } };
    const element = video.current;
    element.addEventListener('loadedmetadata', ready);
    return () => { active = false; controller.abort(); clearTimeout(timer); element.removeEventListener('loadedmetadata', ready); release?.(); };
  }, [api, animeId, episode.number, retry]);
  return <section className="anime-player" aria-label={`${title} player`}>
    <div className="anime-player-frame"><video key={`${animeId}/${episode.number}/${retry}`} ref={video} controls playsInline crossOrigin="anonymous" preload="metadata"
      aria-label={`${title} episode ${episode.number} video`}>
      {state.subtitles.map((track, index) => <track key={track.src} kind="subtitles" src={track.src} label={track.label} srcLang={track.language}
        default={track.language === 'en' && state.subtitles.findIndex(item => item.language === 'en') === index} />)}
    </video></div>
    {state.error ? <div className="anime-notice" role="alert"><p>This episode could not play. Please retry or choose another episode.</p>
      <button className="room-button room-button-secondary" type="button" onClick={() => setRetry(value => value + 1)}>Retry playback</button></div>
      : !state.ready && <p className="anime-notice" role="status">Preparing video…</p>}
    <p className="anime-player-note">Solo viewing · Subtitled. Use the player controls for playback, captions and fullscreen.</p>
  </section>;
}
