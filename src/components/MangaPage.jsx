import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bookmark, BookOpen, Search } from 'lucide-react';
import { createMangaApi } from '../manga/api';
import MangaReader from './MangaReader';
import LoadingSkeleton from './LoadingSkeleton';
import PosterImage from './PosterImage';
import './MangaPage.css';
const EMPTY = { items: [], status: 'guest', persistent: true };
function Cover({ item, api }) {
  const url = api.coverUrl(item.id);
  return <PosterImage src={url} alt={`Cover for ${item.title}`} fallback={<BookOpen aria-hidden="true" />} />;
}
export default function MangaPage({ api, proxyUrl = import.meta.env.VITE_MEDIA_PROXY_URL || '', mangaId = null, chapterId = null, invalidManga = false, navigate = () => {}, library = EMPTY }) {
  const local = useMemo(() => createMangaApi({ proxyUrl }), [proxyUrl]), service = api || local;
  const [search, setSearch] = useState(''), [draft, setDraft] = useState(''), [page, setPage] = useState(1), [chapterPage, setChapterPage] = useState(1), [collection, setCollection] = useState('browse'), [retry, setRetry] = useState(0);
  const [resource, setResource] = useState({ key: '', loading: true }), [action, setAction] = useState({ pending: false, error: '' });
  const [chapterNavigation, setChapterNavigation] = useState({ key: '', items: [], loading: false });
  const key = chapterId ? `read/${mangaId}/${chapterId}` : mangaId ? `title/${mangaId}/${chapterPage}` : `list/${search}/${page}`;
  useEffect(() => {
    if (invalidManga || (!mangaId && collection !== 'browse')) return;
    const controller = new AbortController(); let active = true; setResource({ key, loading: true });
    const options = { signal: controller.signal };
    const pending = mangaId ? Promise.all([service.details(mangaId, options), chapterId ? service.chapter(mangaId, chapterId, options) : service.chapters(mangaId, chapterPage, options)]) : service.list({ search, page }, options);
    Promise.resolve(pending).then(value => { if (active) setResource(mangaId ? { key, loading: false, item: value[0], chapter: chapterId ? value[1] : null, feed: chapterId ? null : value[1] } : { key, loading: false, catalog: value }); })
      .catch(error => { if (active && error?.name !== 'AbortError') setResource({ key, loading: false, error: 'Manga or chapter could not be loaded. Please try again.' }); });
    return () => { active = false; controller.abort(); };
  }, [service, key, mangaId, chapterId, invalidManga, collection, search, page, chapterPage, retry]);
  useEffect(() => { setChapterPage(1); setAction({ pending: false, error: '' }); }, [mangaId]);
  useEffect(() => {
    if (!mangaId || !chapterId || invalidManga || !service.navigation) return;
    const controller = new AbortController();
    setChapterNavigation({ key: mangaId, items: [], loading: true });
    service.navigation(mangaId, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setChapterNavigation({ key: mangaId, items: value.items, loading: false });
    }).catch(() => { if (!controller.signal.aborted) setChapterNavigation({ key: mangaId, items: [], loading: false, error: true }); });
    return () => controller.abort();
  }, [service, mangaId, chapterId, invalidManga, retry]);
  const data = resource.key === key ? resource : { loading: true };
  const toggle = async item => {
    if (action.pending || !library.toggle) return; setAction({ pending: true, error: '' });
    try { await library.toggle({ id: item.id, title: item.title }); setAction({ pending: false, error: '' }); }
    catch { setAction({ pending: false, error: 'Your saved manga could not be updated. Please try again.' }); }
  };
  const saved = id => library.items.some(item => item.id === id && item.saved);
  const items = collection === 'browse' ? data.catalog?.items || [] : library.items.filter(item => collection === 'saved' ? item.saved : item.chapterId);
  const attribution = <p className="manga-credits">Manga information and images provided by <a href="https://mangadex.org" target="_blank" rel="noopener noreferrer">MangaDex</a>. Chapter availability and translations vary.</p>;
  return <div className="home-page manga-page">
    {invalidManga ? <><h1>Manga unavailable</h1><p role="alert">This manga address is not available.</p><button className="room-button room-button-secondary" onClick={() => navigate('manga')}>Browse manga</button></>
      : mangaId ? <>
        {!chapterId && <button className="anime-back" type="button" onClick={() => navigate('manga')}><ArrowLeft aria-hidden="true" />Browse manga</button>}
        {data.loading && <LoadingSkeleton variant="detail" label="Loading manga…" />}
        {data.error && <div className="anime-notice" role="alert"><p>{data.error}</p><button className="room-button room-button-secondary" type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
        {data.item && (chapterId ? data.chapter?.external ? <><h1>{data.item.title}</h1><p className="anime-notice">This chapter is available through an external publisher.</p><a className="anime-external" href={`https://mangadex.org/chapter/${chapterId}`} target="_blank" rel="noopener noreferrer">Open chapter on MangaDex</a></>
          : library.status === 'syncing' ? <LoadingSkeleton variant="player" label="Loading your reading position…" /> : data.chapter && <>
            <MangaReader key={`${mangaId}/${chapterId}`} manga={data.item} chapter={data.chapter} api={service} library={library} navigate={navigate}
              chapterFeed={chapterNavigation.key === mangaId ? { ...chapterNavigation, items: [...new Map(chapterNavigation.items.map(item => { const match = item.id === chapterId || item.aliases?.includes(chapterId); return [match ? chapterId : item.id, match ? { ...item, ...data.chapter } : item]; })).values()] } : null} />
            {chapterNavigation.error && <p className="anime-notice" role="status">Chapter navigation could not load. Reading is still available. <button className="room-button room-button-quiet" onClick={() => setRetry(value => value + 1)}>Retry chapter navigation</button></p>}
          </>
          : <><section className="manga-detail"><div className="manga-detail-cover"><Cover item={data.item} api={service} /></div><div><p className="manga-eyebrow">Manga</p><h1>{data.item.title}</h1>
            <p className="manga-secondary">{[data.item.year, data.item.status].filter(Boolean).join(' · ')}</p><p className="manga-description">{data.item.description || 'No description is available.'}</p>
            {data.item.authors.length > 0 && <p className="manga-secondary">By {data.item.authors.join(', ')}</p>}<p className="manga-secondary">{data.item.genres.join(' · ')}</p>
            <button className="room-button room-button-secondary" type="button" aria-pressed={saved(mangaId)} disabled={action.pending || library.status === 'syncing' || !library.toggle} onClick={() => void toggle(data.item)}><Bookmark aria-hidden="true" />{saved(mangaId) ? 'Remove saved manga' : 'Save manga'}</button>
            {library.items.find(item => item.id === mangaId && item.chapterId) && <button className="room-button room-button-primary" type="button" onClick={() => navigate('manga', mangaId, library.items.find(item => item.id === mangaId).chapterId)}>Continue reading</button>}
          </div></section>
          <section aria-label="Manga chapters" className="manga-chapters"><h2>English chapters</h2>
            {!data.feed?.items.length && <p className="anime-notice">No English chapters are available here. Availability can change after removals or licensing updates.</p>}
            <ul>{(data.feed?.items || []).map(chapter => <li key={chapter.id}><div><strong>Chapter {chapter.number || '—'}{chapter.title ? ` · ${chapter.title}` : ''}</strong>
              <p>{chapter.groups.map(group => group.name).join(', ') || 'Group not listed'}{chapter.pageCount ? ` · ${chapter.pageCount} pages` : ''}</p></div>
              {chapter.external ? <a className="room-button room-button-secondary" href={`https://mangadex.org/chapter/${chapter.id}`} target="_blank" rel="noopener noreferrer">Open external chapter</a>
                : <button className="room-button room-button-secondary" type="button" onClick={() => navigate('manga', mangaId, chapter.id)}>Read chapter {chapter.number || '—'}</button>}</li>)}</ul>
            <div className="manga-pagination">{chapterPage > 1 && <button className="room-button room-button-secondary" onClick={() => setChapterPage(value => value - 1)}>Previous chapters</button>}{data.feed?.pageInfo.hasNextPage && <button className="room-button room-button-secondary" onClick={() => setChapterPage(value => value + 1)}>More chapters</button>}</div>
          </section>{attribution}</>)}
      </> : <>
        <div className="manga-intro"><p className="manga-eyebrow">A different kind of story night.</p><h1>Find your next manga.</h1><p>Browse stories, save a title and pick up where you left off.</p></div>
        <div className="anime-collections" role="group" aria-label="Manga collections">{[['browse', 'Browse manga'], ['saved', 'Saved manga'], ['reading', 'Continue reading']].map(([id, label]) => <button key={id} type="button" aria-pressed={collection === id} onClick={() => setCollection(id)}>{label}</button>)}</div>
        {collection === 'browse' && <form className="manga-search" aria-label="Find manga" onSubmit={event => { event.preventDefault(); setSearch(draft.trim()); setPage(1); }}>
          <label>Manga title<div><Search aria-hidden="true" /><input type="search" value={draft} maxLength={80} placeholder="Search manga" onChange={event => setDraft(event.target.value)} /></div></label><button className="room-button room-button-primary" type="submit">Search manga</button>
        </form>}
        {collection === 'browse' && data.loading && <LoadingSkeleton label="Loading manga…" />}
        {collection === 'browse' && data.error && <div className="anime-notice" role="alert">{data.error}<button className="room-button room-button-secondary" type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
        {collection !== 'browse' && library.status === 'syncing' && <LoadingSkeleton variant="grid" label="Loading your manga library…" />}
        {!items.length && (collection === 'browse' ? !data.loading && !data.error : library.status !== 'syncing') && <p className="library-empty">{collection === 'saved' ? 'Save a manga to find it here.' : collection === 'reading' ? 'Chapters you read will appear here.' : 'No manga found. Try another title.'}</p>}
        <div className="manga-grid">{items.map(item => <article className="manga-card" key={item.id}>
          <button type="button" className="anime-card-open" aria-label={`Details for ${item.title}`} onClick={() => navigate('manga', item.id)}><Cover item={item} api={service} /><span className="anime-card-copy"><strong>{item.title}</strong><span>{item.year || ''}</span></span></button>
          <button className="anime-wishlist" type="button" aria-label={`${saved(item.id) ? 'Unsave' : 'Save'} ${item.title}`} aria-pressed={saved(item.id)} disabled={action.pending || library.status === 'syncing' || !library.toggle} onClick={() => void toggle(item)}><Bookmark aria-hidden="true" /></button>
          {collection === 'reading' && item.chapterId && <button className="room-button room-button-quiet" onClick={() => navigate('manga', item.id, item.chapterId)}>Resume at page {item.page + 1}</button>}
        </article>)}</div>
        {collection === 'browse' && <div className="manga-pagination">{page > 1 && <button className="room-button room-button-secondary" type="button" onClick={() => setPage(value => value - 1)}>Previous manga</button>}{data.catalog?.pageInfo.hasNextPage && <button className="room-button room-button-secondary" type="button" onClick={() => setPage(value => value + 1)}>More manga</button>}</div>}
        {attribution}
      </>}
    {action.error && <p className="anime-notice" role="alert">{action.error}</p>}{library.error && <p className="anime-notice" role="status">{library.error}</p>}
    {library.persistent === false && <p className="anime-notice">Reading progress lasts for this session only because browser storage is unavailable.</p>}
    {library.status !== 'guest' && library.guestItemCount > 0 && <div className="manga-import"><p>Your guest saved manga and reading positions remain on this device until you import them.</p><button className="room-button room-button-secondary" disabled={action.pending} onClick={() => {
      setAction({ pending: true, error: '' }); Promise.resolve().then(library.importGuest).then(() => setAction({ pending: false, error: '' })).catch(() => setAction({ pending: false, error: 'Could not import your manga library. Please try again.' }));
    }}>Import guest manga</button></div>}
  </div>;
}
