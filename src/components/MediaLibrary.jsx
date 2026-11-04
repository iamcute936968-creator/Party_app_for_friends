import { useState } from 'react';
import { Bookmark, Clock3, Play, X } from 'lucide-react';
import { mediaKey, parseMediaLink } from '../library/viewingLibrary';
import './MediaLibrary.css';
import AnimeSavedList from './AnimeSavedList';
import MovieSavedList from './MovieSavedList';
const time = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
export default function MediaLibrary({ library, onChoose, canChoose = true, current, onResume, canResume = false, standalone = false, animeFavorites, onOpenAnime, movieLibrary, navigate }) {
  const [tab, setTab] = useState('Continue watching');
  const [url, setUrl] = useState(''); const [title, setTitle] = useState(''); const [error, setError] = useState('');
  if (!library) return null;
  const Heading = standalone ? 'h1' : 'h2';
  const currentItem = current && library.items.find(item => mediaKey(item) === mediaKey(current));
  const items = library.items.filter(item => tab === 'Wishlist' ? item.wishlist : tab === 'History' ? item.lastWatchedAt > 0 : item.position > 0 && item.lastWatchedAt > 0 && !item.completed);
  const hasMovies = movieLibrary?.items.some(item => tab === 'Wishlist' ? item.wishlist : tab === 'History' ? item.lastWatchedAt > 0 : item.position > 0 && item.lastWatchedAt > 0 && !item.completed);
  return <section className="media-library" aria-label="Your viewing library">
    <div className="library-heading"><Heading>Your library</Heading><p>{library.cloudStatus && library.cloudStatus !== 'guest' ? 'Your saved videos, synced across devices.' : 'Your saved videos on this device.'}</p></div>
    {library.cloudError && <p className="library-notice" role="alert">{library.cloudError}</p>}
    {!library.persistent && <p className="library-notice" role="status">Saved for this session only. Browser storage is unavailable.</p>}
    {current && <div className="library-current">
      <button className="room-button room-button-secondary" onClick={() => library.toggle(current)}><Bookmark aria-hidden="true" />{currentItem?.wishlist ? 'Remove current video from wishlist' : 'Save current video to wishlist'}</button>
      {currentItem?.position > 0 && !currentItem.completed && onResume && <button className="room-button room-button-primary" disabled={!canResume || !canChoose} onClick={() => onResume(currentItem)}><Play aria-hidden="true" />Resume at {time(currentItem.position)}</button>}
    </div>}
    <div className="library-tabs" role="group" aria-label="Library sections">{['Continue watching', 'History', 'Wishlist'].map(name => <button key={name} type="button" aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}</div>
    {tab === 'Wishlist' && <form className="library-save" onSubmit={event => {
      event.preventDefault(); const media = parseMediaLink(url);
      if (!media) { setError('Enter a valid HTTPS YouTube or Google Drive link.'); return; }
      if (!library.items.some(item => mediaKey(item) === mediaKey(media) && item.wishlist)) library.toggle({ ...media, title });
      setUrl(''); setTitle(''); setError('');
    }}>
      <label>Save a video link<input value={url} onChange={event => setUrl(event.target.value)} required type="url" placeholder="YouTube or Google Drive link" /></label>
      <label>Video title (optional)<input value={title} onChange={event => setTitle(event.target.value)} maxLength={120} /></label>
      <button type="submit" className="room-button room-button-secondary">Save to wishlist</button>
      {error && <p role="alert">{error}</p>}
    </form>}
    {tab === 'Wishlist' && animeFavorites && <AnimeSavedList favorites={animeFavorites} onOpen={onOpenAnime} wishlist showEmpty />}
    {movieLibrary && <MovieSavedList library={movieLibrary} navigate={navigate} mode={tab} />}
    {!items.length && !hasMovies && !(tab === 'Wishlist' && animeFavorites?.items.length) && <p className="library-empty">{tab === 'Wishlist' ? 'Save something for your next movie night.' : tab === 'History' ? 'Videos you watch will appear here.' : 'Your unfinished videos will appear here.'}</p>}
    <ul className="library-list">{items.map(item => <li key={mediaKey(item)}>
      <span className="library-source" aria-hidden="true"><Clock3 /></span><div><strong>{item.title}</strong><p>{item.source === 'youtube' ? 'YouTube' : 'Google Drive'}{item.lastWatchedAt > 0 ? ` · ${item.completed ? 'Finished' : time(item.position)}` : ''}</p>
        {item.duration > 0 && <progress aria-label={`Progress for ${item.title}`} max={item.duration} value={item.position} />}</div>
      <button className="room-button room-button-secondary" disabled={!canChoose} onClick={() => onChoose?.(item)} aria-label={`Choose ${item.title}`}>Choose</button>
      <button className="library-remove-btn" type="button" onClick={() => (library.remove ? library.remove(item, tab) : library.toggle(item))} aria-label={`Remove ${item.title} from ${tab.toLowerCase()}`} title={`Remove ${item.title} from ${tab.toLowerCase()}`}><X aria-hidden="true" /></button>
    </li>)}</ul>
    {tab === 'History' && items.length > 0 && <button className="library-remove" onClick={library.clearHistory}>Clear viewing history</button>}
  </section>;
}
