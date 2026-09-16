import React, { useState } from 'react';
import { Video, Users, MessageSquare, Youtube, Monitor, Copy, Check, X, Send, Maximize, Minimize, Volume2, VolumeX, Settings, HardDrive, AlertTriangle } from 'lucide-react';

export default function Room(props) {
  const {
    containerRef,
    vidRef,
    driveVideoRef,
    room,
    isHost,
    participants,
    copied,
    copy,
    leave,
    videoId,
    vidSrc,
    isFs,
    floatMsgs,
    toggleFs,
    ytUrl,
    setYtUrl,
    load,
    startShare,
    stopShare,
    togglePlay,
    messages,
    msgInput,
    setMsgInput,
    sendMsg,
    // WebRTC props
    amSharing,
    changeQuality,
    currentQuality,
    // Drive-specific props
    isAuthorized,
    onAuthorize,
    authError,
    driveLoading,
    driveProgress,
    driveError,
    driveMetadata,
    driveTapNeeded,
    onDriveTapToSync,
  } = props;

  // Local state for controls
  const [isMuted, setIsMuted] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  const toggleMute = () => {
    if (vidRef.current) {
      vidRef.current.muted = !vidRef.current.muted;
      setIsMuted(!isMuted);
    }
  };

  const handleQualityChange = (newQuality) => {
    if (amSharing && changeQuality) {
      changeQuality(newQuality);
    }
    setShowQualityMenu(false);
  };

  const qualityLabels = {
    'low': '360p',
    'medium': '720p',
    'high': '1080p',
    'auto': 'Auto'
  };

  // Whether a Drive video is actively loading (downloading Blob).
  const isDriveLoading = vidSrc === 'drive' && driveLoading;
  // Whether Drive video is loaded and ready.
  const isDriveReady = vidSrc === 'drive' && videoId && !driveLoading && !driveError;
  // Warn if the file is not a standard mp4 or webm but still proceed.
  const driveFormatWarning =
    driveMetadata?.mimeType &&
    !driveMetadata.mimeType.includes('mp4') &&
    !driveMetadata.mimeType.includes('webm') &&
    driveMetadata.mimeType.startsWith('video/');

  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col">
      {/* Header - Always visible */}
      <div className="bg-gray-800 border-b border-gray-700 p-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Video className="w-6 h-6 text-purple-400" />
            <div className="min-w-0">
              <h1 className="text-base font-bold text-white truncate">{room?.roomName}</h1>
              <div className="flex items-center gap-2">
                <p className="text-gray-400 text-xs truncate">
                  {room?.id} {isHost && <span className="text-purple-400">(Host)</span>}
                </p>
                {/* Sharing indicator in header */}
                {room?.isSharing && room?.shareHost && (
                  <span className="flex items-center gap-1 text-green-400 text-xs font-semibold">
                    <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                    Screen Sharing
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={copy} className="flex items-center gap-1 bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded-lg text-sm">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button onClick={leave} className="flex items-center gap-1 bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-sm"><X className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {/* Main Content Area - Flex container */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        
        {/* Video Container - Takes available space but constrained */}
        <div ref={containerRef} className="flex-1 bg-black relative min-h-0">
          
          {/* The YouTube player div */}
          <div 
            id="yt-player" 
            className="w-full h-full" 
            style={{ display: (videoId && vidSrc === 'youtube' && !room?.isSharing) ? 'block' : 'none' }}
          ></div>

          {/* Google Drive — HTML5 <video> (replaces the old iframe) */}
          {/*
            playsInline + webkit-playsinline are required for iOS Safari to
            prevent automatic fullscreen on play.
            controls={false}: host-controlled seek bar deferred to a later phase;
            avoids native seek bar / reference-clock feedback conflicts.
          */}
          <video
            ref={driveVideoRef}
            playsInline
            webkit-playsinline="true"
            className="w-full h-full object-contain bg-black"
            style={{
              display: (videoId && vidSrc === 'drive' && !room?.isSharing) ? 'block' : 'none',
              maxWidth: '100%',
              maxHeight: '100%',
            }}
          />

          {/* Drive: Blob download in progress */}
          {isDriveLoading && !room?.isSharing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20">
              <HardDrive className="w-12 h-12 text-purple-400 mb-4 animate-pulse" />
              <p className="text-white text-sm mb-3">Downloading video…</p>
              {/* Progress bar */}
              <div className="w-64 bg-gray-700 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${driveProgress}%` }}
                />
              </div>
              <p className="text-gray-400 text-xs mt-2">{driveProgress}%</p>
              {driveMetadata && (
                <p className="text-gray-500 text-xs mt-1 max-w-xs text-center truncate">
                  {driveMetadata.name}
                  {driveMetadata.size ? ` · ${(Number(driveMetadata.size) / 1048576).toFixed(1)} MB` : ''}
                </p>
              )}
            </div>
          )}

          {/* Drive: error during download or playback */}
          {driveError && !room?.isSharing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20 p-4">
              <AlertTriangle className="w-12 h-12 text-red-400 mb-4" />
              <p className="text-red-300 text-sm text-center max-w-xs">{driveError}</p>
            </div>
          )}

          {/* Drive: format warning banner */}
          {driveFormatWarning && isDriveReady && !room?.isSharing && (
            <div className="absolute top-2 left-2 right-2 bg-yellow-800/80 backdrop-blur-sm text-yellow-200 text-xs px-3 py-2 rounded-lg z-10 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>Format ({driveMetadata.mimeType}) may not play in all browsers. If you see an error, re-encode to MP4/H.264.</span>
            </div>
          )}

          {/* Drive: large file warning (non-blocking) */}
          {driveMetadata?.size && Number(driveMetadata.size) > 524288000 && isDriveLoading && !room?.isSharing && (
            <p className="absolute bottom-8 left-0 right-0 text-center text-yellow-400 text-xs px-4 z-20">
              Large file — download may take a while and use significant memory on mobile.
            </p>
          )}

          {/* Drive: Tap-to-Sync overlay for iOS members */}
          {driveTapNeeded && vidSrc === 'drive' && !isHost && !room?.isSharing && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/60 z-30 cursor-pointer"
              onClick={onDriveTapToSync}
            >
              <div className="text-center px-6 py-8 bg-black/50 rounded-2xl backdrop-blur-sm">
                <HardDrive className="w-12 h-12 text-purple-400 mx-auto mb-3" />
                <p className="text-white text-xl font-semibold mb-1">Tap to Sync</p>
                <p className="text-gray-300 text-sm">Tap to start synchronized playback</p>
              </div>
            </div>
          )}

          {/* Screen Share Video - iOS optimized WITHOUT permanent loading */}
          <video 
            ref={vidRef} 
            autoPlay 
            playsInline
            webkit-playsinline="true"
            className="w-full h-full object-contain bg-black" 
            style={{ 
              display: room?.isSharing ? 'block' : 'none',
              maxWidth: '100%',
              maxHeight: '100%'
            }}
            onLoadStart={() => console.log('📺 Video loadstart event')}
            onLoadedMetadata={() => console.log('📺 Video metadata loaded')}
            onCanPlay={() => console.log('📺 Video can play')}
            onPlay={() => console.log('📺 Video playing')}
            onPause={() => console.log('📺 Video paused')}
            onError={(e) => console.error('📺 Video error:', e)}
          />

          {/* No Video message */}
          {!videoId && !room?.isSharing && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Video className="w-24 h-24 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400 text-xl">No video</p>
              </div>
            </div>
          )}

          {/* Video Controls - Only show when sharing */}
          {room?.isSharing && (
            <div className="absolute bottom-4 right-4 flex gap-2 z-20">
              {/* Mute/Unmute Button */}
              <button 
                onClick={toggleMute}
                className="bg-black/70 hover:bg-black/90 text-white p-3 rounded-full backdrop-blur-sm transition-all"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>

              {/* Quality Selector - Interactive for host, display-only for members */}
              {amSharing ? (
                // HOST: Interactive quality control
                <div className="relative">
                  <button 
                    onClick={() => setShowQualityMenu(!showQualityMenu)}
                    className="bg-black/70 hover:bg-black/90 text-white px-3 py-3 rounded-full backdrop-blur-sm transition-all flex items-center gap-2"
                    title="Quality Settings"
                  >
                    <Settings className="w-5 h-5" />
                    <span className="text-xs font-semibold">{qualityLabels[currentQuality || 'high']}</span>
                  </button>

                  {/* Quality Menu */}
                  {showQualityMenu && (
                    <div className="absolute bottom-full right-0 mb-2 bg-gray-800 rounded-lg shadow-lg border border-gray-700 overflow-hidden min-w-32">
                      {['high', 'medium', 'low'].map((q) => (
                        <button
                          key={q}
                          onClick={() => handleQualityChange(q)}
                          className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                            (currentQuality || 'high') === q 
                              ? 'bg-purple-600 text-white' 
                              : 'text-gray-300 hover:bg-gray-700'
                          }`}
                        >
                          {qualityLabels[q]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                // MEMBER: Display-only quality indicator
                <div className="bg-black/70 text-white px-3 py-3 rounded-full backdrop-blur-sm flex items-center gap-2">
                  <Settings className="w-5 h-5" />
                  <span className="text-xs font-semibold">Auto</span>
                </div>
              )}
            </div>
          )}

          {/* Floating messages */}
          {isFs && floatMsgs.length > 0 && (
            <div className="absolute bottom-20 left-4 right-4 flex flex-col-reverse gap-2 pointer-events-none" style={{ zIndex: 30 }}>
              {floatMsgs.map((msg) => (
                <div key={msg.id} className="bg-black/70 backdrop-blur-md text-white px-4 py-2 rounded-2xl max-w-md shadow-lg">
                  <span className="font-bold text-purple-300">{msg.user}: </span>
                  <span>{msg.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Fullscreen Toggle */}
          <button onClick={toggleFs} className="absolute top-4 right-4 bg-black/60 hover:bg-black/80 text-white p-3 rounded-full z-25">
            {isFs ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
        </div>

        {/* Controls Bar - Always visible at bottom */}
        <div className="bg-gray-800 p-3 border-t border-gray-700 flex-shrink-0">
          {/* Drive auth prompt — shown to ALL participants when Drive is active but not yet authorized.
               Every browser downloads the file using its own OAuth token (zero-backend architecture). */}
          {vidSrc === 'drive' && !isAuthorized && !driveLoading && (
            <div className="mb-3 flex items-center gap-3 bg-blue-900/40 border border-blue-700/40 rounded-lg px-3 py-2">
              <HardDrive className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span className="text-blue-200 text-xs flex-1">
                {isHost
                  ? 'Authorize Google Drive to load and play videos.'
                  : 'Authorize Google Drive to watch this video in your browser.'}
              </span>
              <button
                onClick={onAuthorize}
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-semibold"
              >
                Authorize
              </button>
            </div>
          )}
          {/* Auth error */}
          {authError && (
            <p className="text-red-400 text-xs mb-2 px-1">{authError}</p>
          )}
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <input 
              type="text" 
              placeholder="YouTube or Google Drive URL" 
              value={ytUrl} 
              onChange={(e) => setYtUrl(e.target.value)} 
              className="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm" 
              disabled={room?.isSharing}
            />
            <div className="flex gap-2">
              <button 
                onClick={load} 
                disabled={room?.isSharing}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Youtube className="w-4 h-4" />
                <span>Load</span>
              </button>
              <button 
                onClick={room?.isSharing ? stopShare : startShare} 
                className={`flex items-center gap-2 ${room?.isSharing ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'} text-white px-4 py-2 rounded-lg text-sm`}
              >
                <Monitor className="w-4 h-4" />
                <span>{room?.isSharing ? 'Stop' : 'Share'}</span>
              </button>
              {/* Play/Pause: visible for both YouTube and Drive, host only */}
              {isHost && (vidSrc === 'youtube' || vidSrc === 'drive') && !room?.isSharing && (
                <button 
                  onClick={togglePlay}
                  disabled={vidSrc === 'drive' && driveLoading}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {room?.playbackState === 'PLAYING' ? 'Pause' : 'Play'}
                </button>
              )}
            </div>
          </div>

          {/* Chat and Participants */}
          <div className="bg-gray-700/50 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-400" />
                <span className="text-white text-sm font-semibold">Participants ({participants.length})</span>
              </div>
              <MessageSquare className="w-4 h-4 text-blue-400" />
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {participants.map((p, i) => (
                <div key={i} className="flex items-center gap-2 bg-gray-700 px-3 py-1 rounded-full">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-gray-300 text-xs">{p}</span>
                </div>
              ))}
            </div>
            <div className="max-h-32 overflow-y-auto mb-2 space-y-1">
              {messages.slice(-3).map((m, i) => (
                <div key={i}>
                  {m.type === 'system' ? (
                    <div className="text-center text-gray-400 text-xs italic">{m.text}</div>
                  ) : (
                    <div className="text-xs">
                      <span className="font-bold text-purple-400">{m.user}: </span>
                      <span className="text-gray-200">{m.text}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="Type..." 
                value={msgInput} 
                onChange={(e) => setMsgInput(e.target.value)} 
                onKeyPress={(e) => e.key === 'Enter' && sendMsg()} 
                className="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm" 
              />
              <button onClick={sendMsg} className="bg-purple-600 hover:bg-purple-700 text-white p-2 rounded-lg">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}