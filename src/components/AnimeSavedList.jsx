import LoadingSkeleton from './LoadingSkeleton';
import { useState } from 'react';
import { Bookmark, ArrowRight, X } from 'lucide-react';
import './AnimePage.css';

export default function AnimeSavedList({ favorites, onOpen, showEmpty = false, wishlist = false }) {
  const [error, setError] = useState('');
  if (!favorites || (!showEmpty && !favorites.items.length && !favorites.error)) return null;
  const remove = async item => {
    setError('');
    try { await favorites.remove(item.id); } catch { setError('Could not update saved anime. Please try again.'); }
  };
  return <section className="anime-saved" aria-label={wishlist ? 'Anime wishlist' : 'Saved anime'}>
    <div className="anime-section-heading"><div><h2>{wishlist ? 'Anime wishlist' : 'Saved anime'}</h2><p>Your saved titles, ready for your next watch.</p></div><span>{favorites.items.length} saved</span></div>
    {favorites.error && <p className="anime-notice" role="alert">{favorites.error}</p>}
    {error && <p className="anime-notice" role="alert">{error}</p>}
    {favorites.status === 'syncing' && <LoadingSkeleton variant="episodes" label="Loading saved anime…" />}
    {!favorites.items.length && favorites.status !== 'syncing' && <p className="library-empty">Save a title while exploring anime to find it here.</p>}
    <ul className="anime-saved-list">{favorites.items.map(item => <li key={item.id}>
      <Bookmark aria-hidden="true" /><button className="anime-saved-title" type="button" aria-label={`Open ${item.title}`} onClick={() => onOpen?.(item.id)}>{item.title}<ArrowRight aria-hidden="true" /></button>
      <button className="library-remove-btn" type="button" disabled={favorites.status === 'syncing' || !favorites.remove} onClick={() => void remove(item)} aria-label={`Remove ${item.title} from saved anime`} title={`Remove ${item.title} from saved anime`}><X aria-hidden="true" /></button>
    </li>)}</ul>
  </section>;
}
