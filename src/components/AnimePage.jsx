import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, Clapperboard, ExternalLink, Play, Search, Star } from 'lucide-react';
import { createAnimeApi } from '../anime/api';
import { createParadiseApi, isParadiseId } from '../anime/paradise';
import { getDubEpisodes, getDubSelection, getDubProvider } from '../anime/audioSources';
import AnimePlayer from './AnimePlayer';
import ParadisePlayer from './ParadisePlayer';
import AnimeSavedList from './AnimeSavedList';
import EpisodeNavigator from './EpisodeNavigator';
import LoadingSkeleton from './LoadingSkeleton';
import PosterImage from './PosterImage';
import './AnimePage.css';

const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Mystery', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports'];
const EMPTY = { items: [], status: 'guest', persistent: true };
const displayFormat = value => typeof value === 'string' ? value.replaceAll('_', ' ') : '';

function Trailer({ item, youtubeReady, close, returnFocus }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = returnFocus || document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (dialog.current?.showModal) dialog.current.showModal();
    else dialog.current?.setAttribute('open', '');
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [returnFocus]);
  const dismiss = () => { dialog.current?.close?.(); close(); };
  return <dialog className="anime-trailer" ref={dialog} aria-label={`${item.title} trailer`} onCancel={event => { event.preventDefault(); dismiss(); }}
    onClick={event => { if (event.target === event.currentTarget) dismiss(); }}>
    <div className="anime-trailer-heading"><h2>{item.title} — trailer</h2><button className="room-button room-button-secondary" type="button" onClick={dismiss}>Close trailer</button></div>
    <AnimePlayer title={`${item.title} trailer`} youtubeReady={youtubeReady} episode={{ id: item.trailerId, number: 0, embeddable: true }} />
  </dialog>;
}

function Facts({ item }) {
  return <div className="anime-facts">
    {item.score !== null && item.score !== undefined && <span className="anime-score"><Star aria-hidden="true" />{(item.score / 10).toFixed(1)} / 10</span>}
    {item.year && <span>{item.year}</span>}{item.format && <span>{displayFormat(item.format)}</span>}
    {item.totalEpisodes && <span>{item.totalEpisodes} episodes</span>}{item.duration && <span>{item.duration} min / episode</span>}
  </div>;
}

function Cover({ item }) {
  return <PosterImage src={item.cover} alt={`Cover for ${item.title}`} fallback={<Clapperboard aria-hidden="true" />} />;
}

export default function AnimePage({ api, proxyUrl = import.meta.env.VITE_MEDIA_PROXY_URL || '', animeId = null, episode = null,
  invalidAnime = false, navigate = () => {}, favorites = EMPTY, library, youtubeReady = false, accountScope = 'guest', discovery = false, onWatchTogether, roomBrowser = false }) {
  const localApi = useMemo(() => createAnimeApi({ proxyUrl }), [proxyUrl]);
  const paradiseApi = useMemo(() => createParadiseApi({ proxyUrl }), [proxyUrl]);
  const [collection, setCollection] = useState('all');
  const providerCatalog = animeId ? isParadiseId(animeId) : collection === 'all';
  const service = api || (providerCatalog ? paradiseApi : localApi);
  const [draft, setDraft] = useState(''), [search, setSearch] = useState('');
  const [genre, setGenre] = useState(''), [sort, setSort] = useState('trending'), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [resource, setResource] = useState({ key: '', loading: true, items: [], item: null, pageInfo: {} });
  const [trailer, setTrailer] = useState(null), [action, setAction] = useState({ pending: false, text: '', error: '' });
  const [audioChoice, setAudioChoice] = useState({ animeId: null, value: 'sub' });
  const trailerTrigger = useRef(null);
  const key = animeId ? `title/${animeId}` : JSON.stringify([collection, search, genre, sort]);
  useEffect(() => {
    if (!draft.trim() || draft.trim().length >= 2) {
      const timer = setTimeout(() => { setSearch(draft.trim()); setPage(1); if (draft.trim()) setCollection('all'); }, 400);
      return () => clearTimeout(timer);
    }
  }, [draft]);
  useEffect(() => {
    if (invalidAnime || (!animeId && collection === 'saved')) return;
    let active = true;
    const controller = new AbortController();
    setResource(old => ({ key, loading: true, items: !animeId && page > 1 && old.key === key ? old.items : [], item: null, pageInfo: {}, error: '' }));
    const pending = animeId ? service.details(animeId, { signal: controller.signal })
      : service.list({ collection, search, genre, sort, page }, { signal: controller.signal });
    Promise.resolve(pending).then(data => {
      if (!active) return;
      setResource(old => ({ key, loading: false, item: animeId ? data : null,
        items: animeId ? [] : [...new Map([...(page > 1 && old.key === key ? old.items : []), ...data.items].map(item => [item.id, item])).values()],
        pageInfo: data.pageInfo || {}, notice: data.notice || '', error: '' }));
    }).catch(error => {
      if (active && error?.name !== 'AbortError') setResource(old => ({ key, loading: false,
        items: !animeId && page > 1 && old.key === key ? old.items : [], item: null, pageInfo: {},
        error: error?.code === 'ANIME_NOT_FOUND' ? 'This anime title is not available.' : 'Could not load anime information. Please try again.' }));
    });
    return () => { active = false; controller.abort(); };
  }, [service, key, animeId, collection, search, genre, sort, page, retry, invalidAnime]);
  useEffect(() => { setTrailer(null); setAction({ pending: false, text: '', error: '' }); }, [animeId, episode]);

  const perform = async operation => {
    if (action.pending) return;
    setAction({ pending: true, text: '', error: '' });
    try { await operation(); setAction({ pending: false, text: 'Saved anime updated.', error: '' }); }
    catch { setAction({ pending: false, text: '', error: 'Could not update saved anime. Please try again.' }); }
  };
  const chooseCollection = value => { setCollection(value); setPage(1); setDraft(''); setSearch(''); };
  const detail = resource.key === key ? resource.item : null;
  const loading = resource.key !== key || resource.loading;
  const unavailable = invalidAnime || (animeId && resource.key === key && resource.error);
  const selected = detail?.episodes.find(item => item.number === episode);
  const isSaved = detail && favorites.items.some(item => item.id === detail.id);
  const dubNumbers = getDubEpisodes(detail?.id);
  const dubProvider = getDubProvider(detail?.id);
  const dubSelection = getDubSelection(detail?.id, episode, detail?.title);
  const canDub = episode === null ? detail?.episodes.some(item => dubNumbers.includes(item.number)) : Boolean(selected && dubSelection);
  const isDub = canDub && audioChoice.animeId === animeId && audioChoice.value === 'dub';
  const availableEpisodes = (detail?.episodes || []).filter(item => (!isDub || dubNumbers.includes(item.number)) && item.embeddable);
  const firstEmbeddable = availableEpisodes.find(item => item.embeddable);
  const playingEpisode = isDub && dubSelection ? { ...selected, id: dubSelection.id, source: 'youtube', provider: dubProvider, language: 'English dub', embeddable: true } : selected;
  const chooseTogether = item => {
    const selection = isDub ? getDubSelection(detail.id, item.number, detail.title)
      : isParadiseId(detail.id) ? { source: 'anime', id: detail.id, episode: item.number, title: detail.title, position: 0 }
        : item.embeddable ? { source: 'youtube', id: item.id, title: `${detail.title} · Episode ${item.number}`, position: 0 } : null;
    if (selection) onWatchTogether?.(selection);
  };
  const chooseEpisode = item => {
    if (!roomBrowser) { navigate('anime', detail.id, item.number); return; }
    chooseTogether(item);
  };

  return <div className={discovery ? 'anime-page anime-discovery' : 'home-page anime-page'}>
    {animeId || invalidAnime ? <button className="anime-back" type="button" onClick={() => navigate('anime')}><ArrowLeft aria-hidden="true" />Browse anime</button> : null}
    {unavailable ? <div className="anime-empty"><h1>Anime unavailable</h1><p role="alert">{invalidAnime ? 'This anime address is not available.' : resource.error}</p>
      <button className="room-button room-button-secondary" type="button" onClick={() => invalidAnime ? navigate('anime') : setRetry(value => value + 1)}>Try again</button></div>
      : animeId ? loading ? <LoadingSkeleton variant="detail" label="Loading anime details…" /> : detail && <>
        {!roomBrowser && episode !== null && <div className="anime-watch-heading"><h1>{detail.title} — Episode {episode}</h1>
          {playingEpisode ? <><p>{playingEpisode.provider} · {playingEpisode.language}</p>{playingEpisode.source === 'hls'
            ? <ParadisePlayer key={`${accountScope}/${detail.id}/${episode}/sub`} api={service} animeId={detail.id} title={detail.title} episode={playingEpisode} />
            : <AnimePlayer key={`${accountScope}/${detail.id}/${episode}/${isDub ? 'dub' : 'sub'}`} title={detail.title} episode={playingEpisode}
              youtubeReady={youtubeReady} library={library} scope={accountScope} />}
            <div className="anime-episode-navigation">
              <button className="room-button room-button-quiet" type="button" onClick={() => navigate('anime', detail.id)}>All episode sources</button></div></>
            : <p role="alert">This episode has no verified source here. Choose a source below.</p>}
        </div>}
        <section className={`anime-detail ${episode !== null ? 'anime-detail-compact' : ''}`}>
          {detail.banner && <img className="anime-detail-banner" src={detail.banner} alt="" referrerPolicy="no-referrer" />}
          <div className="anime-detail-cover"><Cover item={detail} /></div>
          <div className="anime-detail-copy">{episode === null ? <h1>{detail.title}</h1> : <h2>{detail.title}</h2>}<Facts item={detail} />
            <p className="anime-description">{detail.description || 'No synopsis is available for this title.'}</p>
            <p className="anime-genres">{detail.genres.join(' · ')}</p>
            <div className="anime-detail-actions">
              {isParadiseId(detail.id) && availableEpisodes.length > 0 && onWatchTogether && <button className="room-button room-button-secondary" type="button"
                onClick={() => chooseTogether(availableEpisodes.find(item => item.number === selected?.number) || availableEpisodes[0])}>{roomBrowser ? 'Play in room' : 'Watch together'}</button>}
              {!roomBrowser && episode === null && firstEmbeddable && <button className="room-button room-button-primary" type="button"
                onClick={() => chooseEpisode(firstEmbeddable)}><Play aria-hidden="true" />Watch episode {firstEmbeddable.number}</button>}
              {!roomBrowser && episode === null && detail.trailerId && <button className="room-button room-button-secondary" type="button" onClick={event => { trailerTrigger.current = event.currentTarget; setTrailer(detail); }}><Clapperboard aria-hidden="true" />Watch trailer</button>}
              <button className="room-button room-button-secondary" type="button" disabled={action.pending || favorites.status === 'syncing' || !favorites.toggle}
                aria-pressed={Boolean(isSaved)} onClick={() => void perform(() => favorites.toggle({ id: detail.id, title: detail.title }))}><Bookmark aria-hidden="true" />{isParadiseId(detail.id) ? isSaved ? 'Remove from wishlist' : 'Add to wishlist' : isSaved ? 'Remove saved anime' : 'Save anime'}</button>
            </div>
            {detail.studio && <p className="anime-secondary">Studio: {detail.studio}</p>}{detail.status && <p className="anime-secondary">Status: {displayFormat(detail.status)}</p>}
          </div>
        </section>
        {detail.notice && <p className="anime-notice" role="status">{detail.notice}</p>}
        <section className="anime-episodes" aria-label="Episode sources"><div className="anime-section-heading"><div><h2>Episode sources</h2>
          <p>{detail.episodes.length} listed here{detail.totalEpisodes ? ` · ${detail.totalEpisodes} episodes in this series` : ''}. Playback availability can vary.</p></div></div>
          <div className="anime-audio-availability" role="group" aria-label="Anime audio"><span>Audio</span>
            <button type="button" aria-pressed={!isDub} onClick={() => setAudioChoice({ animeId, value: 'sub' })}>Sub</button>
            <button type="button" disabled={!canDub} aria-pressed={Boolean(isDub)} aria-describedby="anime-dub-note" onClick={() => setAudioChoice({ animeId, value: 'dub' })}>Dub</button>
            <p id="anime-dub-note">{canDub ? `English dub: ${dubNumbers.length} verified official YouTube episodes. Availability varies by region. Switching audio changes the video source.`
              : dubNumbers.length ? 'No verified English dub is listed for this episode.' : 'Dub audio is not supplied by this source. Subtitle languages change captions only.'}</p></div>
          {isDub ? <p className="anime-secondary">English audio · {dubProvider}</p> : detail.episodes[0]?.language && <p className="anime-secondary">{detail.episodes[0].language}</p>}
          {availableEpisodes.length ? <EpisodeNavigator episodes={availableEpisodes} selectedNumber={episode} onSelect={chooseEpisode} />
            : <p className="anime-notice">No verified in-app episode source is listed for this title. Try its trailer or an official provider below.</p>}
          {detail.episodes.filter(item => !item.embeddable).map(item => <a className="anime-external" key={item.number} href={item.url} target="_blank" rel="noopener noreferrer">Episode {item.number} — Watch on YouTube <ExternalLink aria-hidden="true" /></a>)}
          <div className="anime-provider-links">{detail.links.map(link => <a className="anime-external" key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">Open {link.site}<ExternalLink aria-hidden="true" /></a>)}</div>
        </section>
      </> : <>
        <div className="anime-page-intro"><h1>{discovery ? 'Discover anime.' : 'Find your next anime.'}</h1><p>Explore stories, save your next watch and play subtitled episodes.</p></div>
        {!discovery && <div className="anime-collections" role="group" aria-label="Anime collections">{[['all', 'Explore anime'], ['official', 'Official episodes'], ['saved', 'Saved anime']].map(([value, label]) =>
          <button type="button" key={value} aria-pressed={collection === value} onClick={() => chooseCollection(value)}>{label}</button>)}</div>}
        {collection === 'saved' ? <AnimeSavedList favorites={favorites} showEmpty onOpen={id => navigate('anime', id)} /> : <>
          <form className={`anime-filters ${providerCatalog ? 'anime-filters-provider' : ''}`} aria-label="Find anime" onSubmit={event => { event.preventDefault(); if (draft.trim().length >= 2 || !draft.trim()) { setSearch(draft.trim()); setPage(1); if (draft.trim()) setCollection('all'); } }}>
            <label className="anime-search">Anime title<div><Search aria-hidden="true" /><input type="search" value={draft} maxLength={80} placeholder="Search anime" onChange={event => setDraft(event.target.value)} /></div></label>
            <label>Genre<select value={genre} onChange={event => { setGenre(event.target.value); setPage(1); }}><option value="">All genres</option>{GENRES.map(value => <option key={value}>{value}</option>)}</select></label>
            {!providerCatalog && <label>Sort<select value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}><option value="trending">Trending</option><option value="popular">Popularity</option><option value="score">Highest rated</option></select></label>}
            <button className="room-button room-button-primary" type="submit">Search anime</button>
          </form>
          {resource.notice && <p className="anime-notice" role="status">{resource.notice}</p>}
          {loading && !resource.items.length && <LoadingSkeleton label="Loading anime…" />}
          {!loading && resource.error && <div><p className="anime-notice" role="alert">{resource.error}</p>
            <button className="room-button room-button-secondary" type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
          {!loading && !resource.error && !resource.items.length && <p className="library-empty">No matching anime found. Try another title or genre.</p>}
          <div className={`anime-grid ${collection === 'official' ? 'anime-grid-official' : ''}`}>{(resource.key === key ? resource.items : []).map(item => <article className="anime-card" key={item.id}>
            <button type="button" className="anime-card-open" aria-label={`Details for ${item.title}`} onClick={() => navigate('anime', item.id)}><Cover item={item} /><span className="anime-card-copy"><strong>{item.title}</strong>
              <span>{[item.year, displayFormat(item.format)].filter(Boolean).join(' · ')}</span></span></button>
            <button className="anime-wishlist" type="button" aria-label={`${favorites.items.some(saved => saved.id === item.id) ? 'Remove' : 'Add'} ${item.title} ${favorites.items.some(saved => saved.id === item.id) ? 'from' : 'to'} wishlist`}
              aria-pressed={favorites.items.some(saved => saved.id === item.id)} disabled={action.pending || favorites.status === 'syncing' || !favorites.toggle}
              onClick={() => void perform(() => favorites.toggle({ id: item.id, title: item.title }))}><Bookmark aria-hidden="true" /></button>
            <span className="anime-card-availability">{isParadiseId(item.id) ? 'Subtitled · View episodes' : item.episodes.some(source => source.embeddable) ? 'Official episodes linked' : item.episodes.length ? 'Watch on official provider' : 'Trailers & information'}</span>
            {collection === 'official' && item.episodes[0] && <span className="anime-card-language">{item.episodes[0].language}</span>}
          </article>)}</div>
          {loading && resource.items.length > 0 && <LoadingSkeleton label="Loading more anime…" count={5} />}
          {resource.pageInfo.hasNextPage && <button className="room-button room-button-secondary anime-load-more" type="button" disabled={loading} onClick={() => setPage(value => value + 1)}>Load more anime</button>}
        </>}
      </>}
    {action.text && <p className="anime-notice" role="status">{action.text}</p>}{action.error && <p className="anime-notice" role="alert">{action.error}</p>}
    {favorites.error && <p className="anime-notice" role="alert">{favorites.error}</p>}
    {!favorites.persistent && <p className="anime-notice">Saved anime will last for this session only because browser storage is unavailable.</p>}
    {favorites.status !== 'guest' && favorites.guestItemCount > 0 && <div className="anime-import"><p>Your guest saved anime stay on this device until you import them.</p>
      <button className="room-button room-button-secondary" type="button" disabled={action.pending} onClick={() => void perform(favorites.importGuest)}>Import saved anime</button></div>}
    <p className="anime-attribution">{providerCatalog ? <>Information, artwork and episode sources from AnimeParadise. Playback availability varies by title and region.</>
      : <>Title data from <a href="https://anilist.co" target="_blank" rel="noopener noreferrer">AniList</a>. Videos play from their original YouTube channels. Availability varies by region.</>}</p>
    {trailer && <Trailer item={trailer} youtubeReady={youtubeReady} returnFocus={trailerTrigger.current} close={() => setTrailer(null)} />}
  </div>;
}
