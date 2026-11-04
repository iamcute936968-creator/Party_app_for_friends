import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, ChevronLeft, ChevronRight, Clapperboard, Play, Search, Star } from 'lucide-react';
import { createMovieApi } from '../movies/api';
import { retryDelayMs } from '../movies/retry';
import MoviePlayer from './MoviePlayer';
import MovieSavedList from './MovieSavedList';
import LoadingSkeleton from './LoadingSkeleton';
import PosterImage from './PosterImage';
import EpisodeNavigator from './EpisodeNavigator';
import './MoviesPage.css';
const EMPTY = { items: [], status: 'guest', persistent: true };
const LANGUAGES = [['', 'All languages'], ['en', 'English'], ['hi', 'Hindi'], ['ta', 'Tamil'], ['te', 'Telugu'], ['ml', 'Malayalam'], ['kn', 'Kannada'], ['bn', 'Bengali'], ['ko', 'Korean'], ['ja', 'Japanese']];
const GENRES = [['', 'All genres'], [28, 'Action'], [35, 'Comedy'], [18, 'Drama'], [27, 'Horror'], [878, 'Science Fiction'], [16, 'Animation'], [99, 'Documentary'], [10751, 'Family'], [80, 'Crime'], [14, 'Fantasy'], [9648, 'Mystery'], [10749, 'Romance'], [53, 'Thriller']];
// Two rails per kind keeps the mount at three upstream calls; everything else
// stays reachable through the Language/Genre filters and search.
const ROWS = {
  movie: [
    { id: 'trending', title: 'Trending Now', language: 'en' },
    { id: 'korean', title: 'Korean', language: 'ko' },
    { id: 'animated', title: 'Animated Films', genre: 16 },
  ],
  tv: [
    { id: 'trending', title: 'Trending Now', language: 'en' },
    { id: 'kdrama', title: 'K-Drama', language: 'ko' },
    { id: 'anime', title: 'Anime Series', genre: 16 },
  ],
};
// Rows load on approach when IntersectionObserver exists; test environments load immediately.
function useRowVisible(ref, immediate = false) {
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined' || Boolean(immediate));
  useEffect(() => {
    if (visible || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '600px 0px' });
    observer.observe(ref.current); return () => observer.disconnect();
  }, [visible, ref]);
  return visible;
}
function RowRail({ row, kind, service, navigate, saveButton, retry, onFail, roomBrowser = false }) {
  const { id, sort = 'popular', language = '', genre = 0 } = row;
  const ref = useRef(null), railRef = useRef(null), visible = useRowVisible(ref, roomBrowser);
  const onFailRef = useRef(onFail);
  useEffect(() => { onFailRef.current = onFail; });
  const [feed, setFeed] = useState({ loading: true }), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!visible) return undefined;
    const controller = new AbortController(); let active = true; setFeed({ loading: true });
    service.list({ kind, sort, language, genre, page: 1 }, { signal: controller.signal })
      .then(value => { if (active) setFeed({ loading: false, items: value.items }); })
      .catch(error => {
      if (active && error?.name !== 'AbortError') {
        if (attempt < 2) { const hold = active; setTimeout(() => { if (hold) setAttempt(value => value + 1); }, attempt === 0 ? 1200 : 2400); } else { setFeed({ loading: false, items: [] }); onFailRef.current(); }
      }
    });
    return () => { active = false; controller.abort(); };
  }, [service, kind, id, sort, language, genre, visible, retry, attempt]);
  const nudge = direction => { const rail = railRef.current; if (rail && typeof rail.scrollBy === 'function') rail.scrollBy({ left: direction * Math.max(320, rail.clientWidth * 0.8), behavior: 'smooth' }); };
  const items = feed.items || [];
  if (!feed.loading && !items.length) return null;
  return <section className="movie-row" aria-label={row.title} ref={ref}>
    <h2>{row.title}</h2>
    <div className="movie-rail-shell">
      <button type="button" className="movie-rail-arrow movie-rail-arrow-left" aria-label={`Scroll ${row.title} left`} onClick={() => nudge(-1)}><ChevronLeft aria-hidden="true" /></button>
      {feed.loading ? <div className="movie-rail-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div key={index} />)}</div>
        : <ul className="movie-rail" ref={railRef}>{items.map(title => <li key={title.id}><article className="movie-card">
          <button className="anime-card-open" type="button" aria-label={`Details for ${title.title}`} onClick={() => navigate('movies', { kind: title.mediaKind, id: title.id })}>
            <PosterImage src={title.cover} alt={`Poster for ${title.title}`} fallback={<span className="movie-rail-fallback" aria-hidden="true">{(title.title.trim()[0] || '?').toUpperCase()}</span>} />
            <span className="anime-card-copy"><strong>{title.title}</strong><span>{title.year || (title.mediaKind === 'tv' ? 'TV series' : 'Movie')}</span></span>
          </button>{saveButton(title)}</article></li>)}</ul>}
      <button type="button" className="movie-rail-arrow movie-rail-arrow-right" aria-label={`Scroll ${row.title} right`} onClick={() => nudge(1)}><ChevronRight aria-hidden="true" /></button>
    </div>
  </section>;
}
function MovieHero({ kind, service, start, retry, roomBrowser = false }) {
  const ref = useRef(null), visible = useRowVisible(ref, roomBrowser);
  const [hero, setHero] = useState({ loading: true }), [attempt, setAttempt] = useState(0), [index, setIndex] = useState(0);
  useEffect(() => {
    if (!visible) return undefined;
    const controller = new AbortController(); let active = true; setHero({ loading: true });
    service.list({ kind, language: 'en', page: 1 }, { signal: controller.signal })
      .then(value => { if (active) setHero({ loading: false, items: value.items }); })
      .catch(error => { if (active && error?.name !== 'AbortError') { if (attempt < 1) setAttempt(value => value + 1); else setHero({ loading: false, items: [] }); } });
    return () => { active = false; controller.abort(); };
  }, [service, kind, visible, retry, attempt]);
  const items = hero.items || [];
  const featured = items.slice(0, 5);
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (featured.length < 2 || reduced) return undefined;
    const timer = setInterval(() => setIndex(value => (value + 1) % featured.length), 8000);
    return () => clearInterval(timer);
  }, [featured.length, reduced]);
  useEffect(() => { setIndex(0); }, [kind, retry]);
  const item = featured.length ? featured[index % featured.length] : null;
  if (!item && !hero.loading) return null;
  return <section className="movie-hero" aria-label="Featured tonight" ref={ref}>
    {featured.map(entry => entry.banner && <img key={entry.id} className={`movie-hero-backdrop${entry.id === item?.id ? ' movie-hero-backdrop-active' : ''}`} src={entry.banner} alt="" aria-hidden="true" referrerPolicy="no-referrer" />)}
    <div className="movie-hero-copy" key={item ? item.id : 'loading'}>{item ? <><p className="movie-eyebrow">Featured tonight</p><h1>{item.title}</h1>
      <div className="movie-detail-actions"><button className="room-button room-button-primary" type="button" onClick={() => start(item)}><Play aria-hidden="true" />Play {item.title}</button></div>
      <p className="movie-provider-note">Streamed solo or together in a synced room. Availability varies by title and region.</p></>
      : <div className="movie-hero-skeleton" aria-hidden="true"><span /><span className="short" /></div>}
    </div>
    {!hero.loading && featured.length > 1 && <div className="movie-hero-dots">
      {featured.map((entry, dot) => <button key={entry.id} type="button" className={`movie-hero-dot${entry.id === item?.id ? ' movie-hero-dot-active' : ''}`} aria-label={`Featured title ${dot + 1}: ${entry.title}`} aria-pressed={entry.id === item?.id} onClick={() => setIndex(dot)} />)}
    </div>}
  </section>;
}
function Cover({ item }) {
  return <PosterImage src={item.cover} alt={`Poster for ${item.title}`} fallback={<Clapperboard aria-hidden="true" />} />;
}
function Facts({ item }) {
  return <p className="movie-facts"><span>{item.mediaKind === 'tv' ? 'TV series' : 'Movie'}</span>{item.year && <span>{item.year}</span>}{item.runtime > 0 && <span>{item.runtime} min</span>}{item.score > 0 && <span><Star aria-hidden="true" />{item.score.toFixed(1)}</span>}</p>;
}
export default function MoviesPage({ api, proxyUrl = import.meta.env.VITE_MEDIA_PROXY_URL || '', kind = 'movie', movieId = null, watching = false, season = null, episode = null, invalidMovie = false, library = EMPTY, navigate = () => {}, discovery = false, onWatchTogether, roomBrowser = false }) {
  const local = useMemo(() => createMovieApi({ proxyUrl }), [proxyUrl]), service = api || local;
  const [draft, setDraft] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1), [collection, setCollection] = useState('browse'), [retry, setRetry] = useState(0), [language, setLanguage] = useState(''), [genre, setGenre] = useState(0);
  const sort = 'popular';
  const [resource, setResource] = useState({ key: '', loading: true }), [seasonResource, setSeasonResource] = useState({ key: '', loading: true });
  const [chosenSeason, setChosenSeason] = useState(null), [action, setAction] = useState({ pending: false, error: '' });
  const [chosenEpisodeNumber, setChosenEpisodeNumber] = useState(null), [previewEpisode, setPreviewEpisode] = useState(null);
  const [autoRetry, setAutoRetry] = useState(0), [failedRows, setFailedRows] = useState(() => new Set());
  const key = movieId ? `${kind}/${movieId}` : `${kind}/${search}/${sort}/${language}/${genre}/${page}`;
  useEffect(() => { setAutoRetry(0); setFailedRows(new Set()); }, [key, retry]);
  const showRows = !roomBrowser && !search && !language && !genre;
  useEffect(() => {
    if (invalidMovie || (!movieId && (collection !== 'browse' || showRows))) return;
    const controller = new AbortController(); let active = true; setResource({ key, loading: true });
    const pending = movieId ? service.details(kind, movieId, { signal: controller.signal }) : service.list({ kind, search, sort, page, language, genre }, { signal: controller.signal });
    Promise.resolve(pending).then(value => { if (active) setResource(movieId ? { key, loading: false, item: value } : { key, loading: false, catalog: value }); })
      .catch(error => { if (active && error?.name !== 'AbortError') { const delay = retryDelayMs(autoRetry); if (delay >= 0) setTimeout(() => setAutoRetry(value => value + 1), delay); else setResource({ key, loading: false, error: 'Movies and TV could not be loaded. Please try again in a moment — the title database is briefly limiting requests.' }); } });
    return () => { active = false; controller.abort(); };
  }, [service, kind, movieId, key, invalidMovie, collection, search, sort, page, language, genre, showRows, autoRetry, retry]);
  useEffect(() => { setChosenSeason(null); setChosenEpisodeNumber(null); setPreviewEpisode(null); setAction({ pending: false, error: '' }); }, [kind, movieId]);
  const data = resource.key === key ? resource : { loading: true }, item = data.item;
  const currentSeason = watching ? season : chosenSeason ?? item?.seasons?.find(value => value.number > 0)?.number ?? item?.seasons?.[0]?.number ?? null;
  useEffect(() => { setChosenEpisodeNumber(null); setPreviewEpisode(null); }, [currentSeason]);
  const seasonKey = `${movieId}/${currentSeason}`;
  useEffect(() => {
    if (!item || kind !== 'tv' || currentSeason === null || !item.seasons.some(value => value.number === currentSeason) || typeof service?.season !== 'function') return;
    const controller = new AbortController(); let active = true; setSeasonResource({ key: seasonKey, loading: true });
    service.season(movieId, currentSeason, { signal: controller.signal }).then(value => { if (active) setSeasonResource({ key: seasonKey, loading: false, feed: value }); })
      .catch(error => { if (active && error?.name !== 'AbortError') setSeasonResource({ key: seasonKey, loading: false, error: 'These episodes could not be loaded. Please try again.' }); });
    return () => { active = false; controller.abort(); };
  }, [item, service, kind, movieId, currentSeason, seasonKey, retry]);
  const episodes = seasonResource.key === seasonKey ? seasonResource : { loading: true }, selected = episodes.feed?.episodes.find(value => value.number === episode);
  const episodesList = useMemo(() => Array.isArray(episodes.feed?.episodes) ? episodes.feed.episodes : [], [episodes.feed]);
  const activeEpisode = useMemo(() => {
    if (previewEpisode && episodesList.some(ep => ep.number === previewEpisode.number)) return previewEpisode;
    if (chosenEpisodeNumber !== null) {
      const found = episodesList.find(ep => ep.number === chosenEpisodeNumber);
      if (found) return found;
    }
    return episodesList[0] || null;
  }, [previewEpisode, chosenEpisodeNumber, episodesList]);
  const currentSeasonObj = item?.seasons?.find(s => s.number === currentSeason);
  const currentSeasonName = currentSeasonObj?.name || (currentSeason !== null ? `Season ${currentSeason}` : 'Season 1');
  const isSaved = title => library.items.some(value => value.kind === title.mediaKind && value.id === title.id && value.wishlist);
  const toggle = async title => { if (!library.toggle || action.pending) return; setAction({ pending: true, error: '' }); try { await library.toggle({ kind: title.mediaKind, id: title.id, title: title.title }); setAction({ pending: false, error: '' }); } catch { setAction({ pending: false, error: 'Your wishlist could not be updated. Please try again.' }); } };
  const saveButton = title => <button type="button" className="movie-wishlist" aria-label={`${isSaved(title) ? 'Remove' : 'Add'} ${title.title} ${isSaved(title) ? 'from' : 'to'} wishlist`} aria-pressed={isSaved(title)} disabled={action.pending || library.status === 'syncing' || !library.toggle} onClick={() => void toggle(title)}><Bookmark aria-hidden="true" /></button>;
  const start = (title, extra = {}) => navigate('movies', { kind: title.mediaKind, id: title.id, watch: true, ...extra });
  const together = (extra = {}) => onWatchTogether?.({ source: 'movie', kind: item.mediaKind, id: item.id, title: item.title, season: 0, episode: 0, position: 0, ...extra });
  const itemBookmark = item && library.items.find(value => value.kind === item.mediaKind && value.id === item.id && value.lastWatchedAt > 0 && !value.completed);
  const missingEpisode = watching && kind === 'tv' && item && (!item.seasons.some(value => value.number === season) || (!episodes.loading && !episodes.error && !selected));
  return <div className={discovery ? 'movies-page' : 'home-page movies-page'}>
    {invalidMovie ? <><h1>Title unavailable</h1><p role="alert">This movie or TV address is not available.</p><button className="room-button room-button-secondary" onClick={() => navigate('movies')}>Browse movies & TV</button></>
      : movieId ? <>
        <button className="anime-back" type="button" onClick={() => watching ? navigate('movies', { kind, id: movieId }) : navigate('movies', { kind })}><ArrowLeft aria-hidden="true" />{watching ? 'Back to details' : 'Browse movies & TV'}</button>
        {data.loading && <LoadingSkeleton variant="detail" label={autoRetry > 0 ? 'Retrying…' : 'Loading title...'} />}{data.error && <div className="anime-notice" role="alert">{data.error}<button className="room-button room-button-secondary" onClick={() => { setAutoRetry(0); setRetry(value => value + 1); }}>Try again</button></div>}
        {item && (watching ? <>
          <div className="movie-watch-heading"><p className="movie-eyebrow">Now watching</p><h1>{item.title}</h1><Facts item={item} />{kind === 'tv' && <p>Season {season}, episode {episode}{selected?.title ? ` · ${selected.title}` : ''}</p>}</div>
          {onWatchTogether && !missingEpisode && (kind === 'movie' || selected) && <button className="room-button room-button-secondary" type="button" onClick={() => together(kind === 'tv' ? { season, episode } : {})}>{roomBrowser ? 'Play in room' : 'Watch together'}</button>}
          {missingEpisode ? <p className="anime-notice" role="alert">This episode is not available in the selected season.</p> : kind === 'tv' && episodes.loading ? <LoadingSkeleton variant="player" label="Loading episode..." /> : episodes.error ? <p className="anime-notice" role="alert">{episodes.error}<button className="room-button room-button-secondary" onClick={() => { setAutoRetry(0); setRetry(value => value + 1); }}>Try again</button></p>
            : library.status === 'syncing' ? <LoadingSkeleton variant="player" label="Loading your watch position..." /> : <MoviePlayer key={`${kind}/${movieId}/${season}/${episode}`} item={item} selection={{ kind, id: movieId, season, episode }} library={library} />}
          {kind === 'tv' && selected && <div className="movie-episode-navigation">{[['Previous episode', -1], ['Next episode', 1]].map(([label, step]) => { const index = episodes.feed.episodes.findIndex(value => value.number === episode), next = episodes.feed.episodes[index + step]; return next ? <button className="room-button room-button-secondary" key={label} type="button" onClick={() => start(item, { season, episode: next.number })}>{label}</button> : null; })}</div>}
        </> : <>
          <section className="movie-detail">{item.banner && <img className="movie-detail-banner" src={item.banner} alt="" aria-hidden="true" referrerPolicy="no-referrer" />}<div className="movie-detail-cover"><Cover item={item} /></div><div className="movie-detail-copy"><p className="movie-eyebrow">Your next watch.</p><h1>{item.title}</h1><Facts item={item} />
            <p className="movie-description">{item.description || 'No description is available.'}</p><p className="movie-genres">{item.genres.join(' · ')}</p><div className="movie-detail-actions">{!roomBrowser && kind === 'movie' && <button className="room-button room-button-primary" type="button" onClick={() => start(item)}><Play aria-hidden="true" />Watch movie</button>}
              {kind === 'movie' && onWatchTogether && <button className="room-button room-button-secondary" type="button" onClick={() => together()}><Play aria-hidden="true" />{roomBrowser ? 'Play in room' : 'Watch together'}</button>}
              {!roomBrowser && itemBookmark && <button className="room-button room-button-primary" type="button" onClick={() => start(item, { season: itemBookmark.season, episode: itemBookmark.episode })}><Play aria-hidden="true" />Continue watching</button>}{saveButton(item)}</div>
            <p className="movie-provider-note">Watch solo, or create a synchronized room with Watch together. Availability varies by title and region.</p>
          </div></section>
          {kind === 'tv' && <section className="movie-episodes" aria-label="TV episodes">
            <div className="movie-section-heading">
              <div>
                <h2>Episodes</h2>
                {episodesList.length > 0 && <p className="movie-episodes-subtitle">{episodesList.length} {episodesList.length === 1 ? 'episode' : 'episodes'} listed here. Playback availability can vary.</p>}
              </div>
              {item.seasons.length > 0 && <label className="movie-season-label">Season<select aria-label="Season" value={currentSeason ?? ''} onChange={event => { setChosenSeason(Number(event.target.value)); setChosenEpisodeNumber(null); setPreviewEpisode(null); }}>{item.seasons.map(value => <option key={value.number} value={value.number}>{value.name}</option>)}</select></label>}
            </div>
            {item.seasons.length > 1 && <div className="movie-season-pills" role="group" aria-label="Season selector">{item.seasons.map(s => <button key={s.number} type="button" className="movie-season-pill" aria-pressed={s.number === currentSeason} onClick={() => { setChosenSeason(s.number); setChosenEpisodeNumber(null); setPreviewEpisode(null); }}>{s.name}</button>)}</div>}
            {!item.seasons.length ? <p className="anime-notice">No seasons are listed yet.</p> : episodes.loading ? <LoadingSkeleton variant="episodes" label="Loading episodes..." /> : episodes.error ? <p className="anime-notice" role="alert">{episodes.error}<button className="room-button room-button-secondary" onClick={() => { setAutoRetry(0); setRetry(value => value + 1); }}>Try again</button></p>
              : !episodesList.length ? <p className="anime-notice">No episodes are listed in this season.</p>
              : <>
                <EpisodeNavigator episodes={episodesList} selectedNumber={activeEpisode?.number} onHighlight={ep => setPreviewEpisode(ep)} getAriaLabel={ep => roomBrowser ? `Watch episode ${ep.number} together` : `Watch episode ${ep.number}`} onSelect={ep => { setChosenEpisodeNumber(ep.number); setPreviewEpisode(ep); if (roomBrowser) { together({ season: currentSeason, episode: ep.number }); } else { start(item, { season: currentSeason, episode: ep.number }); } }} />
                {activeEpisode && <article className="movie-active-episode-card" aria-label={`Episode ${activeEpisode.number} details`}>
                  <div className="movie-active-episode-meta">
                    <span className="movie-active-episode-badge">{currentSeasonName} · Episode {activeEpisode.number}</span>
                    {activeEpisode.airDate && <span className="movie-active-episode-date">{activeEpisode.airDate}</span>}
                  </div>
                  <h3 className="movie-active-episode-title">{activeEpisode.title ? `${activeEpisode.number}. ${activeEpisode.title}` : `Episode ${activeEpisode.number}`}</h3>
                  {activeEpisode.description && <p className="movie-active-episode-desc">{activeEpisode.description}</p>}
                  <div className="movie-active-episode-actions">
                    {!roomBrowser && <button type="button" className="room-button room-button-primary" onClick={() => start(item, { season: currentSeason, episode: activeEpisode.number })}><Play aria-hidden="true" />Watch</button>}
                    {!roomBrowser && onWatchTogether && <button className="room-button room-button-secondary" type="button" aria-label={`Watch episode ${activeEpisode.number} together`} onClick={() => together({ season: currentSeason, episode: activeEpisode.number })}>Watch together</button>}
                  </div>
                </article>}
              </>}
          </section>}
        </>)}
      </> : <>
        <div className="movie-intro"><p className="movie-eyebrow">Find something worth your evening.</p><h1>Movies & TV.</h1><p>Big stories. New favourites. Your next watch starts here.</p></div>
        <div className="movie-browse-heading"><div className="anime-collections" role="group" aria-label="Movie collections">{[['browse', 'Explore'], ['saved', 'Wishlist'], ['continue', 'Continue watching']].map(([id, label]) => <button key={id} type="button" aria-pressed={collection === id} onClick={() => setCollection(id)}>{label}</button>)}</div>
          {collection === 'browse' && <div className="movie-kind" role="group" aria-label="Title type">{[['movie', 'Movies'], ['tv', 'TV shows']].map(([type, label]) => <button type="button" key={type} aria-pressed={kind === type} onClick={() => { setPage(1); setLanguage(''); setGenre(0); navigate('movies', { kind: type }); }}>{label}</button>)}</div>}</div>
        {collection === 'browse' ? <>{showRows && !roomBrowser && <MovieHero kind={kind} service={service} start={start} retry={retry} roomBrowser={roomBrowser} />}<form className="movie-search" onSubmit={event => { event.preventDefault(); setSearch(draft.trim()); setPage(1); }}><label>Movie or TV title<div><Search aria-hidden="true" /><input type="search" value={draft} maxLength={80} placeholder={kind === 'movie' ? 'Search movies' : 'Search TV shows'} onChange={event => setDraft(event.target.value)} /></div></label>
          <select className="movie-filter-select" aria-label="Language" value={language} onChange={event => { setLanguage(event.target.value); setPage(1); }}>{LANGUAGES.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}</select>
          <select className="movie-filter-select" aria-label="Genre" value={genre} onChange={event => { setGenre(Number(event.target.value) || 0); setPage(1); }}>{GENRES.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}</select>
          <button className="room-button room-button-primary" type="submit">Search titles</button>
          {!showRows && <button className="room-button room-button-secondary" type="button" onClick={() => { setDraft(''); setSearch(''); setLanguage(''); setGenre(0); setPage(1); }}>Show all rows</button>}</form>
          {showRows ? <>{failedRows.size >= ROWS[kind].length ? <div className="anime-notice" role="alert">The movie catalogue could not be reached right now (the title database is temporarily limiting requests). Please try again in a little while.<button className="room-button room-button-secondary" onClick={() => { setAutoRetry(0); setRetry(value => value + 1); }}>Try again</button></div> : null}<div className="movie-rows">{ROWS[kind].map((row, rowIndex) => <RowRail key={`${kind}/${row.id}`} row={row} kind={kind} service={service} navigate={navigate} saveButton={saveButton} retry={retry} roomBrowser={roomBrowser} onFail={() => setFailedRows(previous => { const next = new Set(previous); next.add(rowIndex); return next; })} />)}</div></>
            : <>{data.loading && <LoadingSkeleton variant="grid" label={autoRetry > 0 ? `Retrying (attempt ${autoRetry + 1})…` : 'Loading titles...'} />}{data.error && <div className="anime-notice" role="alert">{data.error}<button className="room-button room-button-secondary" onClick={() => { setAutoRetry(0); setRetry(value => value + 1); }}>Try again</button></div>}
              {!data.loading && !data.error && !data.catalog?.items.length && <p className="library-empty">No titles found. Try another search.</p>}
              <div className="movie-grid">{(data.catalog?.items || []).map(title => <article className="movie-card" key={title.id}><button className="anime-card-open" type="button" aria-label={`Details for ${title.title}`} onClick={() => navigate('movies', { kind: title.mediaKind, id: title.id })}><Cover item={title} /><span className="anime-card-copy"><strong>{title.title}</strong><span>{title.year || (title.mediaKind === 'tv' ? 'TV series' : 'Movie')}</span></span></button>{saveButton(title)}</article>)}</div>
              <div className="movie-pagination">{page > 1 && <button className="room-button room-button-secondary" onClick={() => setPage(value => value - 1)}>Previous titles</button>}{data.catalog?.pageInfo.hasNextPage && <button className="room-button room-button-secondary" onClick={() => setPage(value => value + 1)}>More titles</button>}</div></>}
        </> : <MovieSavedList library={library} navigate={navigate} mode={collection === 'saved' ? 'Wishlist' : 'Continue watching'} showEmpty />}
      </>}
    {action.error && <p className="anime-notice" role="alert">{action.error}</p>}{library.error && <p className="anime-notice" role="status">{library.error}</p>}{library.persistent === false && <p className="anime-notice">Saved for this session only. Browser storage is unavailable.</p>}
    {library.status !== 'guest' && library.guestItemCount > 0 && <div className="movie-import"><p>Your guest wishlist and watch positions remain on this device until you import them.</p><button className="room-button room-button-secondary" disabled={action.pending} onClick={() => { setAction({ pending: true, error: '' }); Promise.resolve().then(library.importGuest).then(() => setAction({ pending: false, error: '' })).catch(() => setAction({ pending: false, error: 'Your guest movie library could not be imported.' })); }}>Import guest movies</button></div>}
    <div className="movie-attribution"><a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" aria-label="The Movie Database"><img src="/assets/tmdb.svg" alt="TMDB" /></a><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p><p>Catalogue listings do not guarantee player availability.</p></div>
  </div>;
}
