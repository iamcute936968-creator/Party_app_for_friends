import LoadingSkeleton from './LoadingSkeleton';
import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import MediaLibrary from './MediaLibrary';
import UploadsPanel from './UploadsPanel';
const AnimePage = lazy(() => import('./AnimePage'));
const MoviesPage = lazy(() => import('./MoviesPage'));
class CatalogueBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="anime-notice" role="alert">This catalogue could not load. Your room is still connected. Choose another section or close the browser.</p> : this.props.children; }
}

export default function RoomMediaBrowser({ close, onChoose, library, account, roomId, current, resumeLibrary, canResume, animeFavorites, movieLibrary, proxyUrl, canChoose = true, returnFocus }) {
  const dialog = useRef(null), live = useRef(false), choosing = useRef(false);
  const [route, setRoute] = useState({ page: 'anime' }), [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    live.current = true;
    const previous = returnFocus?.current || document.activeElement, overflow = document.body.style.overflow, element = dialog.current;
    document.body.style.overflow = 'hidden';
    if (dialog.current?.showModal) dialog.current.showModal(); else dialog.current?.setAttribute('open', '');
    return () => {
      live.current = false; element?.close?.(); document.body.style.overflow = overflow;
      requestAnimationFrame(() => { if (previous?.isConnected && !previous.disabled && !document.querySelector('dialog[open]')) previous.focus(); });
    };
  }, [returnFocus]);
  const navigate = (page, id) => { setError(''); setRoute(page === 'movies' ? { page, ...id } : { page, id }); };
  const choose = async item => {
    if (choosing.current || !canChoose) return;
    choosing.current = true; setPending(true); setError('');
    try {
      const accepted = await onChoose?.(item);
      if (live.current) { if (accepted === true) close(); else setError('This selection could not be added. Check the connection and try again.'); }
    } catch { if (live.current) setError('This selection could not be added. Please try again.'); }
    finally { choosing.current = false; if (live.current) setPending(false); }
  };
  return <dialog ref={dialog} className="room-media-browser" aria-label="Browse media for this room" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <header className="room-browser-heading"><div><h2>Pick the next watch.</h2><p>Your room and voice stay connected while you browse.</p></div><button type="button" className="stage-button" aria-label="Close browser" onClick={close}><X aria-hidden="true" /></button></header>
    <div className="room-browser-tabs" role="group" aria-label="Media sections">{[['anime', 'Anime'], ['movies', 'Movies & TV'], ['library', 'Library']].map(([page, label]) => <button type="button" key={page} aria-pressed={route.page === page} onClick={() => navigate(page)}>{label}</button>)}</div>
    {pending && <p className="media-feedback" role="status">Adding selection to the room…</p>}{error && <p className="room-error" role="alert">{error}</p>}
    <fieldset className="room-browser-content" disabled={pending || !canChoose} aria-busy={pending}>
      <CatalogueBoundary key={route.page}><Suspense fallback={<LoadingSkeleton variant="grid" label="Loading catalogue…" />}>
        {route.page === 'anime' && <AnimePage roomBrowser proxyUrl={proxyUrl} animeId={route.id || null} favorites={animeFavorites} navigate={navigate} onWatchTogether={choose} />}
        {route.page === 'movies' && <MoviesPage roomBrowser proxyUrl={proxyUrl} kind={route.kind || 'movie'} movieId={route.id || null} library={movieLibrary} navigate={navigate} onWatchTogether={choose} />}
        {route.page === 'library' && <><MediaLibrary library={library} animeFavorites={animeFavorites} onOpenAnime={id => navigate('anime', id)} movieLibrary={movieLibrary} navigate={navigate} onChoose={choose} canChoose={!pending && canChoose} current={current} onResume={resumeLibrary} canResume={canResume} />
          <UploadsPanel account={account} library={library} roomId={roomId} onChoose={choose} proxyUrl={proxyUrl} canChoose={!pending && canChoose} /></>}
      </Suspense></CatalogueBoundary>
    </fieldset>
  </dialog>;
}
