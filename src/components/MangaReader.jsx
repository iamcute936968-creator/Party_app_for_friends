import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

function ReaderImage({ index, chapter, manga, api, active, hostRef, onLoaded }) {
  const [attempt, setAttempt] = useState(0), [status, setStatus] = useState('loading'), [ratio, setRatio] = useState(null);
  const src = useMemo(() => active ? api.pageUrl(manga.id, chapter.id, index, attempt) : '', [active, api, manga.id, chapter.id, index, attempt]);
  useEffect(() => {
    if (!active || status !== 'loading') return;
    const timer = setTimeout(() => setStatus('error'), 30000);
    return () => clearTimeout(timer);
  }, [active, status, attempt]);
  return <div className="manga-page-image" data-page={index} data-testid={`manga-page-${index + 1}`} ref={hostRef}
    aria-busy={active && status === 'loading'} style={!active || status !== 'ready' ? ratio ? { aspectRatio: ratio } : { minHeight: '75vh' } : undefined}>
    {active && status === 'loading' && <p className="manga-image-status" role="status">Loading page {index + 1}…</p>}
    {active && status !== 'error' && <img key={attempt} src={src} alt={`Page ${index + 1} of ${chapter.pageCount}`} decoding="async" referrerPolicy="no-referrer"
      onLoad={event => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setRatio(image.naturalWidth / image.naturalHeight); setStatus('ready'); onLoaded(index); }}
      onError={() => setStatus('error')} />}
    {active && status === 'error' && <div className="manga-image-error" role="alert"><p>Page {index + 1} could not load. Please retry.</p>
      <button className="room-button room-button-secondary" aria-label={`Retry page ${index + 1}`} disabled={attempt >= 99} type="button" onClick={() => { setAttempt(value => value + 1); setStatus('loading'); }}>Retry page</button></div>}
    {!active && <span className="manga-page-placeholder">Page {index + 1}</span>}
  </div>;
}

// chapterFeed: { items: normalized chapters, pageInfo: { page, hasNextPage }, loading? }.
// onChapterPage requests a bounded feed page; adjacent navigation uses known IDs only.
export default function MangaReader({ manga, chapter, api, library, navigate, chapterFeed = null, onChapterPage }) {
  const { record, status: libraryStatus } = library;
  const bookmark = library.items.find(item => item.id === manga.id && item.chapterId === chapter.id);
  const [initial] = useState(() => Math.max(0, Math.min(chapter.pageCount - 1, bookmark?.page || 0)));
  const [page, setPage] = useState(initial), [visiblePage, setVisiblePage] = useState(null), [loaded, setLoaded] = useState(() => new Set()), [saveError, setSaveError] = useState('');
  const hosts = useRef([]), lastSaved = useRef(null), toolbar = useRef(null), pendingJump = useRef(initial), measurePage = useRef(() => {});
  const onLoaded = useCallback(index => {
    setLoaded(current => current.has(index) ? current : new Set([...current, index]));
    if (pendingJump.current !== null) hosts.current[pendingJump.current]?.scrollIntoView?.({ block: 'start' });
    measurePage.current();
  }, []);
  const go = next => {
    if (!Number.isInteger(next) || next < 0 || next >= chapter.pageCount) return;
    pendingJump.current = next; setPage(next); setVisiblePage(null); setSaveError('');
    hosts.current[next]?.scrollIntoView?.({ block: 'start' });
    measurePage.current();
  };
  useEffect(() => {
    const measure = () => {
      const line = Math.max(0, toolbar.current?.getBoundingClientRect().bottom || 0) + 8;
      if (pendingJump.current !== null) {
        const rect = hosts.current[pendingJump.current]?.getBoundingClientRect();
        setVisiblePage(rect?.height && rect.top < innerHeight && rect.bottom > line ? pendingJump.current : null);
        return;
      }
      let closest = null, distance = Infinity;
      hosts.current.forEach((host, index) => {
        const rect = host?.getBoundingClientRect();
        if (!rect || rect.bottom <= line || rect.top >= innerHeight || !rect.height) return;
        const value = rect.top <= line ? 0 : rect.top - line; if (value < distance) { distance = value; closest = index; }
      });
      setVisiblePage(closest); if (closest !== null) setPage(closest);
    };
    measurePage.current = measure;
    let frame = null;
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; measure(); }); };
    const releaseJump = () => { pendingJump.current = null; schedule(); };
    const key = event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key) && !event.target?.closest?.('input, textarea, select, [contenteditable]')) releaseJump(); };
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(measure, { threshold: [0, .1, .5, 1] }) : null;
    hosts.current.forEach(host => host && observer?.observe(host));
    window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule);
    for (const type of ['wheel', 'touchstart', 'pointerdown']) window.addEventListener(type, releaseJump, { passive: true });
    window.addEventListener('keydown', key);
    hosts.current[initial]?.scrollIntoView?.({ block: 'start' }); measure();
    return () => {
      observer?.disconnect(); if (frame !== null) cancelAnimationFrame(frame); measurePage.current = () => {};
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);
      for (const type of ['wheel', 'touchstart', 'pointerdown']) window.removeEventListener(type, releaseJump);
      window.removeEventListener('keydown', key);
    };
  }, [chapter.id, initial]);
  useEffect(() => {
    if (visiblePage === null || !loaded.has(visiblePage) || lastSaved.current === visiblePage || !record || ['syncing', 'error'].includes(libraryStatus)) return;
    lastSaved.current = visiblePage;
    const failed = () => setSaveError('This page could not be saved. Your previous reading position is kept.');
    try { Promise.resolve(record({ id: manga.id, title: manga.title, chapterId: chapter.id, page: visiblePage })).catch(failed); } catch { failed(); }
  }, [visiblePage, loaded, record, libraryStatus, manga.id, manga.title, chapter.id]);
  useEffect(() => {
    const key = event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target?.closest?.('input, textarea, select, button, a, [contenteditable]')) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); go(page + 1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(page - 1); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  const chapters = chapterFeed?.items || [], chapterIndex = chapters.findIndex(item => item.id === chapter.id);
  const previous = chapterIndex > 0 ? chapters[chapterIndex - 1] : null, next = chapterIndex >= 0 ? chapters[chapterIndex + 1] : null;
  const openChapter = item => { if (item && !item.external) navigate('manga', manga.id, item.id); };
  return <section className="manga-reader" aria-label="Manga reader">
    <h1>{manga.title}</h1><p className="manga-reader-chapter">Chapter {chapter.number || '—'}{chapter.title ? ` · ${chapter.title}` : ''}</p>
    <div className="manga-reader-controls" ref={toolbar} role="toolbar" aria-label="Manga page navigation">
      <button className="room-button room-button-quiet" aria-label="All chapters" type="button" onClick={() => navigate('manga', manga.id)}><ArrowLeft aria-hidden="true" /><span>All chapters</span></button>
      <button className="room-button room-button-secondary" aria-label="Previous page" type="button" disabled={page === 0} onClick={() => go(page - 1)}><ArrowLeft aria-hidden="true" /><span>Previous page</span></button>
      <p role="status" aria-live="polite">Page {page + 1} of {chapter.pageCount}</p>
      <button className="room-button room-button-secondary" aria-label="Next page" type="button" disabled={page + 1 >= chapter.pageCount} onClick={() => go(page + 1)}><span>Next page</span><ArrowRight aria-hidden="true" /></button>
    </div>
    <div className="manga-reader-pages">{Array.from({ length: chapter.pageCount }, (_, index) => <ReaderImage key={index} index={index} chapter={chapter} manga={manga} api={api}
      active={Math.abs(index - page) <= 1} hostRef={node => { hosts.current[index] = node; }} onLoaded={onLoaded} />)}</div>
    <form className="manga-page-jump" aria-label="Jump to manga page" onSubmit={event => { event.preventDefault(); go(Number(new FormData(event.currentTarget).get('page')) - 1); }}>
      <label>Go to page<input key={page} name="page" type="number" min="1" max={chapter.pageCount} defaultValue={page + 1} inputMode="numeric" /></label>
      <button className="room-button room-button-quiet" type="submit">Go</button>
    </form>
    <div className="manga-reader-end"><p>End of chapter.</p>{next && !next.external ? <button className="room-button room-button-primary" type="button" onClick={() => openChapter(next)}>Next chapter</button>
      : <button className="room-button room-button-primary" type="button" onClick={() => navigate('manga', manga.id)}>Choose another chapter</button>}</div>
    {chapterFeed && <div className="manga-chapter-navigation" aria-label="Manga chapters">
      <button className="room-button room-button-secondary" type="button" disabled={!previous || previous.external || chapterFeed.loading} onClick={() => openChapter(previous)}><ArrowLeft aria-hidden="true" />Previous chapter</button>
      <label>Jump to chapter<select aria-label="Jump to chapter" value={chapter.id} disabled={chapterFeed.loading} onChange={event => openChapter(chapters.find(item => item.id === event.target.value))}>
        {chapterIndex < 0 && <option value={chapter.id}>Chapter {chapter.number || '—'} (current)</option>}
        {chapters.map(item => <option key={item.id} value={item.id} disabled={item.external}>Chapter {item.number || '—'}{item.title ? ` · ${item.title}` : ''}{item.external ? ' (on MangaDex)' : ''}</option>)}
      </select></label>
      {onChapterPage && <><button className="room-button room-button-quiet" type="button" disabled={chapterFeed.loading || !(chapterFeed.pageInfo?.page > 1)} onClick={() => onChapterPage(chapterFeed.pageInfo.page - 1)}>Previous chapters</button>
        <button className="room-button room-button-quiet" type="button" disabled={chapterFeed.loading || !chapterFeed.pageInfo?.hasNextPage} onClick={() => onChapterPage(chapterFeed.pageInfo.page + 1)}>More chapters</button></>}
    </div>}
    {saveError && <p className="anime-notice" role="status">{saveError}</p>}
    <p className="manga-credits">Read with <a href={`https://mangadex.org/chapter/${chapter.id}`} target="_blank" rel="noopener noreferrer">MangaDex</a>
      {chapter.groups.length > 0 && <> · Scanlation by {chapter.groups.map((group, index) => <span key={group.id}>{index ? ', ' : ''}<a href={`https://mangadex.org/group/${group.id}`} target="_blank" rel="noopener noreferrer">{group.name}</a></span>)}</>}</p>
  </section>;
}
