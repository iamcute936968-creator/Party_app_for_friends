import LoadingSkeleton from './LoadingSkeleton';
import { lazy, Suspense, useState } from 'react';
import MediaDiscovery from './MediaDiscovery';
const AnimePage = lazy(() => import('./AnimePage'));
const MoviesPage = lazy(() => import('./MoviesPage'));
export default function DiscoverPage({ favorites, movieLibrary, accountScope, navigate, active = true }) {
  const [section, setSection] = useState('anime');
  return <>
    <div className="anime-collections" role="group" aria-label="Discover sections">
      <button type="button" aria-pressed={section === 'anime'} onClick={() => setSection('anime')}>Anime</button>
      <button type="button" aria-pressed={section === 'movies'} onClick={() => setSection('movies')}>Movies & TV</button>
      <button type="button" aria-pressed={section === 'references'} onClick={() => setSection('references')}>Reference search</button>
    </div>
    {active && section === 'anime' && <Suspense fallback={<LoadingSkeleton variant="grid" label="Loading anime discovery…" />}><AnimePage discovery favorites={favorites} navigate={navigate} /></Suspense>}
    <div hidden={section !== 'movies'}>{section === 'movies' && <Suspense fallback={<LoadingSkeleton variant="grid" label="Loading movies &amp; TV..." />}><MoviesPage key={accountScope || 'guest'} discovery library={movieLibrary} navigate={navigate} /></Suspense>}</div>
    <div hidden={section !== 'references'}><MediaDiscovery standalone /></div>
  </>;
}
