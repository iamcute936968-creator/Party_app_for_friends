import React, { useEffect, useId, useRef, useState } from 'react';

function safeUrl(value, hostname, prefix = '/') {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === hostname && !url.port && !url.username && !url.password && url.pathname.startsWith(prefix) && url.pathname.length > prefix.length ? url.href : '';
  } catch { return ''; }
}

function normalizeItem(value, details = false) {
  if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 200 || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 300) return null;
  if (details && typeof value.extract !== 'string') return null;
  return { id: value.id, title: value.title,
    description: typeof value.description === 'string' ? value.description.slice(0, 1000) : '',
    excerpt: typeof value.excerpt === 'string' ? value.excerpt.slice(0, 10000) : '',
    extract: typeof value.extract === 'string' ? value.extract.slice(0, 30000) : '',
    posterUrl: safeUrl(value.posterUrl, 'upload.wikimedia.org'),
    sourceUrl: safeUrl(value.sourceUrl, 'en.wikipedia.org', '/wiki/') };
}

export default function MediaDiscovery({ proxyUrl = import.meta.env.VITE_MEDIA_PROXY_URL || '', standalone = false }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [details, setDetails] = useState(null);
  const [pending, setPending] = useState('');
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const request = useRef({ generation: 0, controller: null });
  const inputId = useId();
  const configured = Boolean(proxyUrl.trim());
  const Heading = standalone ? 'h1' : 'h2';

  useEffect(() => () => { request.current.generation++; request.current.controller?.abort(); }, [proxyUrl]);

  async function load(kind, value) {
    request.current.controller?.abort();
    const generation = ++request.current.generation;
    const controller = new AbortController();
    request.current.controller = controller;
    setPending(kind); setError(''); setDetails(null);
    if (kind === 'search') { setItems([]); setSearched(false); }
    try {
      const parameter = kind === 'search' ? 'q' : 'id';
      const response = await fetch(`${proxyUrl.trim().replace(/\/+$/, '')}/api/catalog/${kind}?${parameter}=${encodeURIComponent(value)}`, { signal: controller.signal, credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (generation !== request.current.generation) return;
      if (kind === 'search') {
        if (!data || !Array.isArray(data.items)) throw new Error();
        const seen = new Set();
        setItems(data.items.slice(0, 12).map(value => normalizeItem(value)).filter(value => {
          if (!value || seen.has(value.id)) return false;
          seen.add(value.id); return true;
        }));
        setSearched(true);
      } else {
        const result = normalizeItem(data, true);
        if (!result) throw new Error();
        setDetails(result);
      }
    } catch {
      if (generation === request.current.generation) setError('Could not load title information. Please try again.');
    } finally {
      if (generation === request.current.generation) setPending('');
    }
  }

  function submit(event) {
    event.preventDefault();
    const value = query.trim();
    if (value.length < 2 || value.length > 80 || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      setError('Enter a title using 2 to 80 characters.'); return;
    }
    if (configured) void load('search', value);
  }

  return <section className="media-discovery media-library" aria-label="Movie and anime discovery" aria-busy={Boolean(pending)}>
    <div className="library-heading"><Heading>Discover movies and anime</Heading><p>Explore titles, posters and details for your next movie night.</p></div>
    {!configured && <p role="status">Discovery is unavailable until the media service is connected.</p>}
    <form className="entry-form discovery-search" aria-label="Find movies and anime" onSubmit={submit} noValidate>
      <label htmlFor={inputId}>Movie or anime title</label>
      <input id={inputId} value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" placeholder="Search a movie or anime" disabled={!configured} />
      <button type="submit" className="room-button room-button-primary" disabled={!configured}>Search titles</button>
    </form>
    {pending && <p role="status">{pending === 'search' ? 'Searching titles…' : 'Loading title details…'}</p>}
    {error && <p role="alert">{error}</p>}
    {searched && !pending && !items.length && <p className="library-empty">No titles found. Try another title.</p>}
    <div className="discovery-grid">{items.map(item => <article className="discovery-card" key={item.id}>
      {item.posterUrl && <img src={item.posterUrl} alt={`Poster for ${item.title}`} loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}
      <div><h3>{item.title}</h3>{item.description && <p>{item.description}</p>}{item.excerpt && <p>{item.excerpt}</p>}
        <button type="button" className="room-button room-button-secondary" aria-label={`Details for ${item.title}`} onClick={() => void load('details', item.id)}>Details</button></div>
    </article>)}</div>
    {details && <section className="discovery-details" aria-label="Movie or anime details">
      <h3>{details.title}</h3>{details.description && <p>{details.description}</p>}<p>{details.extract}</p>
      {details.sourceUrl && <a href={details.sourceUrl} target="_blank" rel="noopener noreferrer">Read on Wikipedia</a>}
    </section>}
    <p className="discovery-attribution">Wikipedia / Wikimedia</p>
  </section>;
}
