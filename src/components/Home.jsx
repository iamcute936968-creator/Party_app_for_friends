import LoadingSkeleton from './LoadingSkeleton';
import React from 'react';
import { MonitorPlay, RefreshCw, Library, UserRound, ArrowRight, Clapperboard, Film } from 'lucide-react';
import { useEffect, useRef, lazy, Suspense } from 'react';
import './Home.css';
import MediaLibrary from './MediaLibrary';
import UploadsPanel from './UploadsPanel';
import AccountPanel from './AccountPanel';
import { AvatarPicker, ParticipantAvatar } from './ParticipantAvatar';
import { HOME_PAGES, useHomeNavigation } from '../hooks/useHomeNavigation';

const AnimePage = lazy(() => import('./AnimePage'));
const MangaPage = lazy(() => import('./MangaPage'));
const MoviesPage = lazy(() => import('./MoviesPage'));
const pageIcons = { watch: MonitorPlay, movies: Film, anime: Clapperboard, library: Library };

export default function Home({
  username = '',
  setUsername,
  roomId = '',
  setRoomId,
  loading,
  create,
  join,
  lastHostRoom,
  rejoinAsHost,
  entryAction,
  entryError,
  library, chooseLibrary, selectedMedia,
  participantFeatures,
  account, accountProfile,
  animeFavorites, mangaLibrary, movieLibrary, youtubeReady, accountScope,
}) {
  const errorRef = useRef(null);
  const mainRef = useRef(null);
  const { page, animeId, episode, invalidAnime, mangaId, chapterId, invalidManga, movieId, movieKind, movieWatching, movieSeason, movieEpisode, invalidMovie, navigate } = useHomeNavigation();
  const destinationKey = `${page}/${animeId || mangaId || movieId || ''}/${episode || chapterId || ''}/${movieKind || ''}/${movieWatching || ''}/${movieSeason ?? ''}/${movieEpisode ?? ''}/${invalidAnime || invalidManga || invalidMovie || false}`;
  const previousPage = useRef(destinationKey);
  useEffect(() => {
    if (previousPage.current !== destinationKey) {
      mainRef.current?.focus();
      window.scrollTo(0, 0);
      previousPage.current = destinationKey;
    }
  }, [destinationKey]);
  useEffect(() => { if (entryError) errorRef.current?.focus(); }, [entryError]);
  const canCreate = !loading && Boolean(username.trim());
  const canJoin = canCreate && Boolean(roomId.trim());
  const follow = (event, id) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(id);
  };
  const choose = item => { chooseLibrary?.(item); navigate('watch'); };

  const submitCreate = (event) => {
    event.preventDefault();
    if (canCreate) create();
  };

  const submitJoin = (event) => {
    event.preventDefault();
    if (canJoin) join();
  };

  return (
    <div className="home-shell">
      <a className="home-skip-link" href="#home-content">Skip to content</a>
      <header className="home-header">
        <a className="brand-wordmark" href="/" aria-label="Watch Party home" onClick={event => follow(event, 'watch')}>
          <MonitorPlay className="brand-icon" aria-hidden="true" />
          <span>WATCH PARTY</span>
        </a>
        <nav className="home-navigation" aria-label="Main navigation">
          {HOME_PAGES.filter(destination => destination.inNavigation !== false).map(destination => {
            const Icon = pageIcons[destination.id];
            return <a key={destination.id} href={destination.path} aria-current={page === destination.id || (page === 'manga' && destination.id === 'anime') ? 'page' : undefined}
              onClick={event => follow(event, destination.id)}><Icon aria-hidden="true" /><span>{destination.label}</span></a>;
          })}
        </nav>
        <a className="home-account" href="/account" aria-label="Account" title="Account" aria-current={page === 'account' ? 'page' : undefined} onClick={event => follow(event, 'account')}>
          {account?.user && !account.user.isAnonymous ? <span aria-hidden="true">{(accountProfile?.profile?.displayName || username || account.user.displayName || 'Account').slice(0, 1).toUpperCase()}</span> : <UserRound aria-hidden="true" />}
        </a>
      </header>

      <main id="home-content" className="home-content" tabIndex={-1} ref={mainRef}>
      {['anime', 'manga'].includes(page) && <nav className="anime-section-navigation" aria-label="Anime and manga">
        <a href="/anime" aria-current={page === 'anime' ? 'page' : undefined} onClick={event => follow(event, 'anime')}>Anime</a>
        <a href="/manga" aria-current={page === 'manga' ? 'page' : undefined} onClick={event => follow(event, 'manga')}>Manga</a>
      </nav>}
      <div className="home-main" hidden={page !== 'watch'}>
        <div className="home-landscape" aria-hidden="true" />
        <section className="home-hero" aria-labelledby="home-title">
          <h1 id="home-title">A good film.<br />Better company.</h1>
          <p className="home-description">Start a private room, invite your people, and watch in sync.</p>
          <p className="home-sources">YouTube <span>/</span> Google Drive <span>/</span> Screen sharing</p>
        </section>

        <section className="entry-panel" aria-labelledby="entry-title" aria-busy={Boolean(loading)}>
          <h2 id="entry-title">Make it a movie night.</h2>
          <p className="entry-description">Your room. Your people. Your pick.</p>
          {selectedMedia && <p className="entry-selection" role="status">Next room: {selectedMedia.title}. Create a room to {selectedMedia.position > 0 && !selectedMedia.completed ? 'resume watching' : 'watch'}.</p>}
          {entryError && <p className="entry-error" role="alert" tabIndex={-1} ref={errorRef}>{entryError}</p>}

          <form className="entry-form" onSubmit={submitCreate}>
            <label htmlFor="entry-name">Your name</label>
            <input
              id="entry-name"
              type="text"
              autoComplete="nickname"
              placeholder="Enter your name"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              disabled={loading}
            />
            <button className="entry-button entry-button-primary" type="submit" disabled={!canCreate}>
              {entryAction === 'create' ? 'Creating...' : 'Create Room'}
            </button>
          </form>

          <div className="entry-divider" />

          <form id="join-room" className="entry-form entry-join" onSubmit={submitJoin} aria-labelledby="entry-join-title">
            <h2 id="entry-join-title">Join Room</h2>
            <label htmlFor="entry-room">Room code or invite link</label>
            <input
              id="entry-room"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck="false"
              placeholder="Enter Room ID"
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
              required
              disabled={loading}
            />
            <button className="entry-button entry-button-secondary" type="submit" disabled={!canJoin}>
              {entryAction === 'join' ? 'Joining...' : 'Join Room'}
            </button>
          </form>

          {lastHostRoom && (
            <div className="entry-recovery">
              <p>Return to room <span>{lastHostRoom.roomId}</span></p>
              <button
                className="entry-recovery-button"
                type="button"
                disabled={!canCreate}
                onClick={() => { if (canCreate) rejoinAsHost(); }}
              >
                <RefreshCw size={16} aria-hidden="true" />
                {entryAction === 'rejoin' ? 'Rejoining...' : 'Rejoin as Host'}
              </button>
            </div>
          )}
        </section>
      </div>

      <div className="home-page home-library-page" hidden={page !== 'library'}>
        <MediaLibrary library={library} onChoose={choose} canChoose={!loading} standalone animeFavorites={animeFavorites} onOpenAnime={id => navigate('anime', id)} movieLibrary={movieLibrary} navigate={navigate} />
        {page === 'library' && <UploadsPanel key={accountScope || 'guest'} account={account} library={library} />}
        <a className="page-back-link" href="/" onClick={event => follow(event, 'watch')}>Start a watch party <ArrowRight aria-hidden="true" /></a>
      </div>
      {page === 'movies' && <Suspense fallback={<LoadingSkeleton variant="grid" label="Loading movies &amp; TV..." />}>
        <MoviesPage key={accountScope || 'guest'} kind={movieKind} movieId={movieId} watching={movieWatching} season={movieSeason} episode={movieEpisode} invalidMovie={invalidMovie} library={movieLibrary} navigate={navigate} onWatchTogether={choose} />
      </Suspense>}
      {page === 'anime' && <Suspense fallback={<LoadingSkeleton variant="grid" label="Loading anime section..." />}>
        <AnimePage animeId={animeId} episode={episode} invalidAnime={invalidAnime} navigate={navigate}
          favorites={animeFavorites} library={library} youtubeReady={youtubeReady} accountScope={accountScope} onWatchTogether={choose} />
      </Suspense>}
      {page === 'manga' && <Suspense fallback={<LoadingSkeleton variant="grid" label="Loading manga section..." />}>
        <MangaPage key={accountScope || 'guest'} mangaId={mangaId} chapterId={chapterId} invalidManga={invalidManga} navigate={navigate} library={mangaLibrary} />
      </Suspense>}
      <div className="home-page home-account-page" hidden={page !== 'account'}>
        <div className="home-page-heading"><h1>Account</h1><p>Manage your profile and how you appear in a room.</p></div>
        <div className="account-layout">
          <div><AccountPanel account={account} library={library} profile={accountProfile?.profile} saveProfile={accountProfile?.saveProfile} />
            {accountProfile?.error && <p className="entry-error" role="status">{accountProfile.error}</p>}</div>
          {participantFeatures && <section className="account-appearance" aria-labelledby="appearance-title">
            <h2 id="appearance-title">Room appearance</h2><p>Choose the colour people see beside your name.</p>
            <div className="entry-avatar"><ParticipantAvatar name={username || accountProfile?.profile?.displayName} profile={{ avatar: participantFeatures.avatar }} />
              <AvatarPicker value={participantFeatures.avatar} onChange={participantFeatures.chooseAvatar} /></div>
            {participantFeatures.error && <p className="participant-profile-error" role="status">{participantFeatures.error}</p>}
          </section>}
        </div>
      </div>
      </main>
      <footer className="home-footer">Good company. Great cinema.</footer>
    </div>
  );
}
