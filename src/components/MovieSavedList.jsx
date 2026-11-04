import { useState } from 'react';
import { Bookmark, Play, X } from 'lucide-react';
import './MoviesPage.css';
const clock = position => `${Math.floor(position / 60)}:${String(Math.floor(position % 60)).padStart(2, '0')}`;
export default function MovieSavedList({ library, navigate = () => {}, mode = 'Wishlist', showEmpty = false }) {
  const [pending, setPending] = useState(''), [error, setError] = useState('');
  const items = (library?.items || []).filter(item => mode === 'Wishlist' ? item.wishlist : mode === 'History' ? item.lastWatchedAt > 0 : item.lastWatchedAt > 0 && item.position > 0 && !item.completed);
  if (!library || (!items.length && !showEmpty)) return null;
  const sectionLabel = mode === 'Wishlist' ? 'wishlist' : mode === 'History' ? 'history' : 'continue watching';
  return <section className="movie-saved" aria-label={`Movies and TV ${sectionLabel}`}>
    <h2>{mode === 'Wishlist' ? 'Movies & TV wishlist' : mode === 'History' ? 'Movies & TV history' : 'Continue movies & TV'}</h2>
    {showEmpty && !items.length && <p className="library-empty">{mode === 'Wishlist' ? 'Save a movie or show to find it here.' : 'Your watched movies and shows will appear here.'}</p>}
    <ul className="anime-saved-list">{items.map(item => <li key={`${item.kind}/${item.id}`}>
      <Bookmark aria-hidden="true" /><button className="anime-saved-title" type="button" onClick={() => navigate('movies', { kind: item.kind, id: item.id })} aria-label={`Open ${item.title}`}><span>{item.title}<small>{item.kind === 'tv' ? 'TV series' : 'Movie'}{item.lastWatchedAt > 0 ? ` · ${item.completed ? 'Finished' : clock(item.position)}` : ''}</small></span></button>
      {mode !== 'Wishlist' && item.lastWatchedAt > 0 && <button className="room-button room-button-secondary" type="button" aria-label={`Resume ${item.title}`} onClick={() => navigate('movies', { kind: item.kind, id: item.id, watch: true, season: item.season, episode: item.episode })}><Play aria-hidden="true" />Resume</button>}
      <button className="library-remove-btn" type="button" disabled={Boolean(pending) || library.status === 'syncing'} aria-label={`Remove ${item.title} from ${sectionLabel}`} title={`Remove ${item.title} from ${sectionLabel}`} onClick={async () => {
        setPending(`${item.kind}/${item.id}`); setError(''); try { await library.remove(item, { mode }); } catch { setError(`Your movie ${sectionLabel} could not be updated. Please try again.`); } finally { setPending(''); }
      }}><X aria-hidden="true" /></button>
    </li>)}</ul>{error && <p className="anime-notice" role="alert">{error}</p>}
  </section>;
}
