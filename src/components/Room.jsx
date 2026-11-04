import React, { useEffect, useRef, useState } from 'react';
import { Film, Users, MonitorPlay, Monitor, Copy, Check, LogOut, Share2, Maximize, Minimize, Volume2, VolumeX, Settings, HardDrive, AlertTriangle, Play, Pause, Search } from 'lucide-react';
import DriveTimeline from './DriveTimeline';
import ConnectionStatus from './ConnectionStatus';
import StageConversation from './StageConversation';
import TypingIndicator from './TypingIndicator';
import { cineSrcEmbedUrl } from '../adapters/CineSrcAdapter';
import { movieRoomScope, movieRoomSelection } from '../movies/room';
import './Room.css';
import VoiceDock from './VoiceDock';
import RoomPeople from './RoomPeople';
import RoomChatPanel from './RoomChatPanel';
import ReactionPicker from './ReactionPicker';
import { reactionOptions } from '../reactions/options';
import RoomMediaBrowser from './RoomMediaBrowser';
import RoomAnimeControls from './RoomAnimeControls';
import RoomTvControls from './RoomTvControls';



export default function Room(props) {
  const {
    containerRef, vidRef, driveVideoRef, room, isHost, participants,
    connectionStatus, presenceError, copied, copy, leave, videoId, vidSrc,
    isFs, toggleFs, ytUrl, setYtUrl, load, startShare, stopShare,
    togglePlay, messages, msgInput, setMsgInput, sendMsg, amSharing, canStopShare = amSharing,
    changeQuality, currentQuality, isAuthorized, onAuthorize, authError, chatStatus = 'idle',
    driveLoading, driveProgress, driveError, driveMetadata, isStreaming = false,
    driveTapNeeded, onDriveTapToSync, onDriveSeekStart, onDriveSeekCommit,
    reactions = [], sendReaction, canReact = false, reactionError,
    inviteUrl, inviteStatus = 'idle', inviteError, shareInvite,
    mediaAction = null, mediaError = '', mediaLoaded = false,
    retryDrive, canRetryDrive = false,
    playbackError, recoveryPhase = 'idle', retryPlayback, canRetryPlayback = false,
    isPlaybackReady = true, isBuffering = false,
    shareError, shareStatus = 'idle', reconnectShare, shareMuted = false,
    voice, username, screenCaptureSupported = true,
    library, resumeLibrary,
    participantFeatures, typingOffset = 0, animeMedia = {},
    account, uploadProxyUrl, moderation, youtubeAutoplayBlocked = false,
    chatUserId, editMessage, editStatus, editError, sendVoice, loadVoice, clearVoice,
    movieFrameRef, moviePlayerGeneration = 0, mediaAdapter, animeFavorites, movieLibrary,
  } = props;
  const [browserOpen, setBrowserOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [stageChatOpen, setStageChatOpen] = useState(false);
  const [roomTab, setRoomTab] = useState('watch');
  const [peopleOpen, setPeopleOpen] = useState(false);
  const peopleTrigger = useRef(null);
  const mediaFeedback = useRef(null);
  const browserTrigger = useRef(null);
  useEffect(() => { if (mediaError) mediaFeedback.current?.focus(); }, [mediaError]);
  useEffect(() => { setIsMuted(Boolean(shareMuted)); }, [shareMuted]);
  const toggleMute = () => {
    if (vidRef.current) {
      vidRef.current.muted = !vidRef.current.muted;
      setIsMuted(vidRef.current.muted);
    }
  };
  const qualityLabels = { low: '360p', medium: '720p', high: '1080p', auto: 'Auto' };
  const invitePending = inviteStatus === 'copying' || inviteStatus === 'sharing';
  const mediaPending = Boolean(mediaAction);
  const isDriveLoading = vidSrc === 'drive' && driveLoading;
  const isAnime = vidSrc === 'anime';
  const isMovie = vidSrc === 'movie';
  const isDriveReady = vidSrc === 'drive' && videoId && !driveLoading && !driveError;
  const driveFormatWarning = driveMetadata?.mimeType?.startsWith('video/') &&
    !driveMetadata.mimeType.includes('mp4') && !driveMetadata.mimeType.includes('webm');

  return (
    <div className="room-shell">
      <header className="room-header">
        <div className="room-brand"><MonitorPlay aria-hidden="true" /><span>WATCH PARTY</span></div>
        <div className="room-identity">
          <h1>{room?.roomName}</h1>
          <p><span>{room?.id}</span><span className="room-role">{isHost ? 'Host' : 'Member'}</span>
            {room?.isSharing && <span className="sharing-label">Screen sharing</span>}
          </p>
        </div>
        <div className="room-actions"><button ref={peopleTrigger} className="room-button room-button-secondary" type="button" onClick={() => setPeopleOpen(true)}><Users aria-hidden="true" />People ({participants.length})</button>
          <button className="room-button room-button-secondary" onClick={copy} disabled={invitePending}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {inviteStatus === 'copying' ? 'Copying...' : copied ? 'Invite copied' : 'Copy invite'}
          </button>
          <button className="room-button room-button-secondary" onClick={shareInvite} disabled={invitePending}>
            <Share2 aria-hidden="true" />{inviteStatus === 'sharing' ? 'Opening share...' : 'Share invite'}
          </button>
          <button className="room-button room-button-quiet" onClick={leave}><LogOut aria-hidden="true" />Leave room</button>
        </div>
        <div className="room-tabs" role="tablist" aria-label="Room sections">{[['watch', 'Watch'], ['chat', 'Chat']].map(([id, label]) => <button type="button" key={id} id={`room-tab-${id}`} role="tab" aria-selected={roomTab === id} aria-controls={`room-panel-${id}`} tabIndex={roomTab === id ? 0 : -1} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'watch' : event.key === 'End' ? 'chat' : roomTab === 'watch' ? 'chat' : 'watch'; setRoomTab(next); document.getElementById(`room-tab-${next}`)?.focus(); } }} onClick={() => setRoomTab(id)}>{label}</button>)}</div>
        <ConnectionStatus status={connectionStatus} />
        {inviteStatus === 'shared' && <p className="invite-feedback" role="status" aria-label="Invite feedback">Share options opened.</p>}
      </header>
      {inviteStatus === 'manual' && <section className="invite-recovery" aria-label="Invite recovery">
        <p role="alert">{inviteError}</p>
        <label htmlFor="invite-link">Invite link</label>
        <input id="invite-link" value={inviteUrl || ''} readOnly onFocus={(event) => event.currentTarget.select()} />
      </section>}
      {presenceError && <p className="room-presence-error" role="alert">{presenceError}</p>}

      <main className="room-layout" role="tabpanel" id="room-panel-watch" aria-labelledby="room-tab-watch" hidden={roomTab !== 'watch'}>
        <section className="viewing-column" aria-label="Viewing area">
          <div ref={containerRef} className="video-stage" data-fullscreen={Boolean(isFs)} data-chat-open={stageChatOpen}>
            <div id="yt-player" className="stage-media" style={{ display: videoId && vidSrc === 'youtube' && !room?.isSharing ? 'block' : 'none' }} />
            {isMovie && videoId && !room?.isSharing && <iframe key={`${movieRoomScope(room)}/${moviePlayerGeneration}`} ref={movieFrameRef}
              className="stage-media" title="Room movie player" src={cineSrcEmbedUrl(movieRoomSelection(room))}
              sandbox="allow-scripts allow-same-origin"
              allow="autoplay; fullscreen; picture-in-picture; screen-wake-lock" allowFullScreen referrerPolicy="origin" />}
            <video ref={driveVideoRef} playsInline webkit-playsinline="true" preload="metadata" className="stage-media" aria-label="Room video"
              crossOrigin={isAnime ? 'anonymous' : undefined}
              style={{ display: videoId && (vidSrc === 'drive' || isAnime) && !room?.isSharing ? 'block' : 'none' }}>
              {isAnime && (animeMedia.subtitles || []).map((track, index, tracks) => <track key={track.src} kind="subtitles" src={track.src} srcLang={track.language} label={track.label}
                default={track.language === 'en' && tracks.findIndex(item => item.language === 'en') === index} />)}
            </video>
            <video ref={vidRef} autoPlay playsInline webkit-playsinline="true" className="stage-media"
              style={{ display: room?.isSharing ? 'block' : 'none' }} />

            {!videoId && !room?.isSharing && <div className="stage-empty">
              <span className="empty-film" aria-hidden="true"><Film /><Play /></span><h2>Your screen is ready.</h2>
              <p>Add a video or a Watch Party watch link to begin.</p>
            </div>}

            {isBuffering && !room?.isSharing && <p className="buffering-notice" role="status" aria-label="Playback buffering">Buffering… Playback will sync when ready.</p>}
            {isAnime && animeMedia.loading && !room?.isSharing && <div className="stage-overlay" role="status" aria-label="Anime preparation"><p>Preparing anime…</p></div>}
            {isAnime && animeMedia.error && !room?.isSharing && !playbackError && <div className="stage-overlay stage-error" role="alert"><p>{animeMedia.error}</p>
              <button className="room-button room-button-primary" onClick={animeMedia.reload} disabled={animeMedia.loading}>Retry anime playback</button></div>}
            {isDriveLoading && !room?.isSharing && <div className="stage-overlay" role="status" aria-label="Video preparation">
              <HardDrive aria-hidden="true" />
              <p>{isStreaming ? 'Preparing stream…' : 'Downloading video…'}</p>
              {!isStreaming && <><progress max="100" value={driveProgress || 0} aria-label="Video download" /><p>{driveProgress || 0}%</p></>}
              {driveMetadata && <p className="stage-file">{driveMetadata.name || driveMetadata.fileId}
                {driveMetadata.size ? ` · ${(Number(driveMetadata.size) / 1048576).toFixed(1)} MB` : ''}</p>}
              {!isStreaming && Number(driveMetadata?.size) > 524288000 && <p className="stage-warning">Large file — download may take a while and use significant memory on mobile.</p>}
            </div>}
            {vidSrc === 'drive' && videoId && driveError && !playbackError && recoveryPhase === 'idle' && !room?.isSharing && <div className="stage-overlay stage-error" role="alert">
              <AlertTriangle aria-hidden="true" /><p>{driveError}</p>
              {(isStreaming || isAuthorized) && retryDrive && <button className="room-button room-button-primary"
                onClick={retryDrive} disabled={!canRetryDrive || mediaPending || driveLoading}>Retry video</button>}
            </div>}
            {(playbackError || recoveryPhase === 'recovering') && !room?.isSharing && <div className="stage-overlay stage-error playback-error">
              <AlertTriangle aria-hidden="true" />
              {playbackError && <p role="alert">{playbackError.message}</p>}
              {(recoveryPhase === 'waiting' || recoveryPhase === 'recovering') && <p role="status" aria-label="Playback recovery">
                {recoveryPhase === 'waiting' ? 'Retrying shortly...' : 'Recovering playback...'}
              </p>}
              {playbackError?.retryable && <button className="room-button room-button-primary" onClick={retryPlayback}
                disabled={!canRetryPlayback || recoveryPhase === 'recovering'}>Retry playback</button>}
            </div>}
            {driveFormatWarning && isDriveReady && !room?.isSharing && <p className="format-warning">
              <AlertTriangle aria-hidden="true" />Format ({driveMetadata.mimeType}) may not play in all browsers. If you see an error, re-encode to MP4/H.264.
            </p>}
            {driveTapNeeded && !playbackError && recoveryPhase === 'idle' && (vidSrc === 'drive' || isAnime) && !room?.isSharing && <button className="stage-overlay tap-sync" onClick={onDriveTapToSync}>
              <Play aria-hidden="true" /><strong>Tap to Sync</strong><span>Start synchronized playback</span>
            </button>}

            {room?.isSharing && <div className="share-controls">
              <button className="stage-button" onClick={toggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'}>{isMuted ? <VolumeX /> : <Volume2 />}</button>
              {amSharing ? <div className="quality-control">
                <button className="stage-button" onClick={() => setShowQualityMenu(!showQualityMenu)} aria-label="Quality settings" aria-expanded={showQualityMenu}>
                  <Settings aria-hidden="true" /><span>{qualityLabels[currentQuality || 'high']}</span>
                </button>
                {showQualityMenu && <div className="quality-menu">{['high', 'medium', 'low'].map((quality) => <button key={quality}
                  aria-pressed={(currentQuality || 'high') === quality}
                  onClick={() => { changeQuality?.(quality); setShowQualityMenu(false); }}>{qualityLabels[quality]}</button>)}</div>}
              </div> : <span className="quality-auto"><Settings aria-hidden="true" />Auto</span>}
            </div>}
            <StageConversation key={room?.id} roomId={room?.id} username={username} messages={messages} draft={msgInput} setDraft={setMsgInput}
              send={sendMsg} status={chatStatus} fullscreen={isFs} onOpenChange={setStageChatOpen}
              uid={chatUserId} editMessage={editMessage} editStatus={editStatus} loadVoice={loadVoice} offset={typingOffset}
              stopTyping={participantFeatures?.stopTyping}
              typingIndicator={<TypingIndicator records={room?.typing} participants={participants} username={username} offset={typingOffset} />} />
            <div className="reactions-feed" role="log" aria-label="Live reactions" aria-live="polite" aria-relevant="additions">
              {reactions.map((reaction) => {
                const option = reactionOptions.find((item) => item.kind === reaction.kind);
                if (!option) return null;
                const Icon = option.Icon;
                return <p className="reaction-chip" key={reaction.id}><Icon aria-hidden="true" />
                  <span className="reaction-user">{reaction.user}</span><span>{option.label}</span></p>;
              })}
            </div>
            <button className="stage-button fullscreen-button" onClick={toggleFs} aria-label={isFs ? 'Exit fullscreen' : 'Enter fullscreen'}>
              {isFs ? <Minimize /> : <Maximize />}
            </button>
          </div>
          {(vidSrc === 'drive' || isAnime || isMovie) && videoId && !room?.isSharing && <DriveTimeline key={isMovie ? movieRoomScope(room) : undefined} driveVideoRef={driveVideoRef} mediaAdapter={isMovie ? mediaAdapter : undefined} isHost={isHost}
            onSeekStart={onDriveSeekStart} onSeekCommit={onDriveSeekCommit} disabled={isAnime ? animeMedia.loading : driveLoading} />}
          <div className="room-transport" role="group" aria-label="Playback controls">
              {isHost && ['youtube', 'drive', 'anime', 'movie'].includes(vidSrc) && !room?.isSharing && <button className="room-button room-button-secondary" onClick={togglePlay} disabled={mediaPending || !videoId || !isPlaybackReady || (vidSrc === 'drive' && driveLoading) || (isAnime && animeMedia.loading)}>
                {room?.playbackState === 'PLAYING' ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{videoId && !isPlaybackReady ? 'Preparing player...' : room?.playbackState === 'PLAYING' ? 'Pause' : 'Play'}
              </button>}
            <button ref={browserTrigger} className="room-button room-button-primary" type="button" onClick={() => setBrowserOpen(true)} disabled={connectionStatus !== 'connected' || mediaPending || room?.isSharing}><Search aria-hidden="true" />Browse media</button>
            <VoiceDock voice={voice} connectionStatus={connectionStatus} />
            <ReactionPicker send={sendReaction} disabled={!canReact} />
          </div>
          {isMovie && !room?.isSharing && <><RoomTvControls room={room} isHost={isHost} onSelect={load} proxyUrl={uploadProxyUrl} disabled={mediaPending || connectionStatus !== 'connected'} /><p><strong>{room?.movieTitle || 'Movie or TV'}</strong>{room?.movieKind === 'tv' ? ` · Season ${room.movieSeason}, episode ${room.movieEpisode}` : ''}</p>
            <p className="media-feedback" role="status" aria-label="Movie playback permission">If playback does not start, tap Play inside the movie player once. Playback will then follow the room.</p>
            <p className="media-feedback">Room player provided by CineSrc. Availability and advertising depend on the provider.</p></>}

          {vidSrc === 'youtube' && youtubeAutoplayBlocked && !room?.isSharing && <p className="media-feedback" role="status" aria-label="YouTube playback permission">
            Tap Play inside the YouTube player to allow playback on this device. Playback will then follow the room.
          </p>}
          {!room?.isSharing && <RoomAnimeControls source={vidSrc} videoId={videoId} room={room} media={animeMedia} isHost={isHost} disabled={mediaPending || connectionStatus !== 'connected'} load={load} videoRef={driveVideoRef} />}

          <div className="media-controls">
            {reactionError && <p className="room-error reaction-error" role="alert">{reactionError}</p>}
            {vidSrc === 'drive' && !isStreaming && !isAuthorized && !driveLoading && <div className="drive-authorization">
              <HardDrive aria-hidden="true" /><p>{isHost ? 'Authorize Google Drive to load and play videos.' : 'Authorize Google Drive to watch this video in your browser.'}</p>
              <button className="room-button room-button-secondary" onClick={onAuthorize} disabled={mediaPending || room?.isSharing}>
                {mediaAction === 'authorize' ? 'Authorizing...' : 'Authorize'}
              </button>
            </div>}
            {authError && !mediaError && !mediaPending && <p className="room-error" role="alert">{authError}</p>}
            <label className="sr-only" htmlFor="video-url">Video URL</label>
            <div className="video-input-row">
              <form className="video-load-form" aria-label="Load a video" noValidate onSubmit={(event) => {
                event.preventDefault();
                if (!mediaPending && !room?.isSharing) load?.();
              }}>
                <input id="video-url" type="url" placeholder="Video or Watch Party watch URL" value={ytUrl} onChange={(event) => setYtUrl(event.target.value)}
                  aria-describedby={mediaError || mediaPending || mediaLoaded ? 'media-feedback' : undefined} disabled={room?.isSharing || mediaPending} />
                <button className="room-button room-button-primary" disabled={room?.isSharing || mediaPending}>
                  {mediaAction === 'load' ? 'Loading...' : mediaError ? 'Retry loading video' : 'Load video'}
                </button>
              </form>
              {(room?.isSharing || screenCaptureSupported) && <button className="room-button room-button-secondary" onClick={() => room?.isSharing ? (canStopShare ? stopShare() : reconnectShare?.()) : startShare()}
                disabled={mediaPending || shareStatus === 'starting' || shareStatus === 'connecting'}><Monitor aria-hidden="true" />
                {shareStatus === 'starting' ? 'Starting share...' : room?.isSharing ? (canStopShare ? 'Stop sharing' : 'Reconnect screen share') : 'Share screen'}
              </button>}

            </div>
            {!screenCaptureSupported && !room?.isSharing && <p className="media-feedback" role="status" aria-label="Screen sharing availability">You can watch screen shares here. To broadcast, use a desktop browser.</p>}
            {shareError && <p className="room-error" role="alert">{shareError}</p>}
            {shareStatus !== 'idle' && <p className="media-feedback" role="status" aria-label="Screen sharing status">
              {shareStatus === 'starting' ? 'Choose a screen in your browser.' : shareStatus === 'connecting' ? 'Connecting to screen share...' : shareStatus === 'sharing' ? 'Your screen is being shared.' : shareStatus === 'viewing' ? 'Connected to screen share.' : 'Screen share disconnected. Reconnect to try again.'}
            </p>}
            {mediaError ? <p id="media-feedback" ref={mediaFeedback} className="room-error" role="alert" tabIndex={-1}>{mediaError}</p> :
              (mediaPending || mediaLoaded) && <p id="media-feedback" className="media-feedback" role="status" aria-label="Media feedback">
                {mediaAction === 'load' ? 'Adding video to the room...' : mediaAction === 'authorize' ? 'Waiting for Google Drive authorization...' : mediaAction === 'retry' ? 'Retrying video...' : 'Video added to the room.'}
              </p>}
            <div className="playback-caption"><span>Supported sources: YouTube, Google Drive, Anime, Movies &amp; TV</span><span>{isHost ? 'You control playback.' : 'The host controls playback.'}</span></div>
          </div>
        </section>
      </main>
      <section className="room-chat-layout" role="tabpanel" id="room-panel-chat" aria-labelledby="room-tab-chat" hidden={roomTab !== 'chat'}>
        <RoomChatPanel active={roomTab === 'chat'} room={room} messages={messages} username={username} uid={chatUserId} draft={msgInput} setDraft={setMsgInput} send={sendMsg} status={chatStatus} editMessage={editMessage} editStatus={editStatus} editError={editError} sendVoice={sendVoice} loadVoice={loadVoice} clearVoice={isHost ? clearVoice : undefined} voice={voice} connected={connectionStatus === 'connected'} participantFeatures={participantFeatures} participants={participants} offset={typingOffset} />
      </section>
      {peopleOpen && <RoomPeople room={room} participants={participants} username={username} participantFeatures={participantFeatures} isHost={isHost} moderation={moderation} connectionStatus={connectionStatus} returnFocus={peopleTrigger} close={() => setPeopleOpen(false)} />}
      {browserOpen && <RoomMediaBrowser key={room?.id} returnFocus={browserTrigger} close={() => setBrowserOpen(false)} onChoose={load} library={library} account={account} resumeLibrary={resumeLibrary} canResume={isHost && isPlaybackReady} roomId={room?.id} current={videoId && !isAnime && !isMovie && !room?.isSharing ? { source: vidSrc, id: videoId, title: driveMetadata?.name } : null} animeFavorites={animeFavorites} movieLibrary={movieLibrary} proxyUrl={uploadProxyUrl} canChoose={connectionStatus === 'connected' && !room?.isSharing && !mediaPending} />}
    </div>
  );
}
