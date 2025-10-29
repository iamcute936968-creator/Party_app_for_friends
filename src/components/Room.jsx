import React, { useState } from 'react';
import { Video, Users, MessageSquare, Youtube, Monitor, Copy, Check, X, Send, Maximize, Minimize, Volume2, VolumeX, Settings } from 'lucide-react';

export default function Room(props) {
  const {
    containerRef,
    vidRef,
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
    sendMsg
  } = props;

  // Local state for controls
  const [isMuted, setIsMuted] = useState(false);
  const [quality, setQuality] = useState('auto'); // 'low', 'medium', 'high', 'auto'
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  const toggleMute = () => {
    if (vidRef.current) {
      vidRef.current.muted = !vidRef.current.muted;
      setIsMuted(!isMuted);
    }
  };

  const changeQuality = (newQuality) => {
    setQuality(newQuality);
    setShowQualityMenu(false);
    
    // Apply quality settings to video element
    if (vidRef.current && vidRef.current.srcObject) {
      const tracks = vidRef.current.srcObject.getVideoTracks();
      if (tracks.length > 0) {
        const track = tracks[0];
        const constraints = {
          'low': { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15 } },
          'medium': { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } },
          'high': { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
          'auto': {} // Let browser decide
        };
        
        track.applyConstraints(constraints[newQuality])
          .then(() => console.log(`Quality changed to ${newQuality}`))
          .catch(e => console.log('Quality change not supported:', e));
      }
    }
  };

  const qualityLabels = {
    'low': '360p',
    'medium': '720p',
    'high': '1080p',
    'auto': 'Auto'
  };

  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col">
      <div className="bg-gray-800 border-b border-gray-700 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Video className="w-6 h-6 text-purple-400" />
            <div className="min-w-0">
              <h1 className="text-base font-bold text-white truncate">{room?.roomName}</h1>
              <p className="text-gray-400 text-xs truncate">{room?.id} {isHost && <span className="text-purple-400">(Host)</span>}</p>
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

      <div className="flex-1 flex flex-col overflow-hidden">
        
        <div ref={containerRef} className="flex-1 bg-black relative">
          
          {/* The YouTube player div (permanent, hidden) */}
          <div 
            id="yt-player" 
            className="w-full h-full" 
            style={{ display: (videoId && vidSrc === 'youtube' && !room?.isSharing) ? 'block' : 'none' }}
          ></div>

          {/* Google Drive player */}
          {videoId && vidSrc === 'drive' && !room?.isSharing && (
            <iframe 
              src={`https://drive.google.com/file/d/${videoId}/preview`} 
              className="w-full h-full" 
              allow="autoplay"
              allowFullScreen
            />
          )}

          {/* Screen Share Video - ALWAYS RENDER (WebRTC uses this) */}
          <video 
            ref={vidRef} 
            autoPlay 
            playsInline 
            className="w-full h-full object-contain" 
            style={{ display: room?.isSharing ? 'block' : 'none' }}
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

          {/* FIXED: Sharing indicator - Only show once at the top */}
          {room?.isSharing && room?.shareHost && (
            <div className="absolute top-4 left-4 bg-red-600/90 backdrop-blur-sm text-white px-4 py-2 rounded-full flex items-center gap-2 z-20">
              <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
              <span className="text-sm font-semibold">{room.shareHost} is sharing</span>
            </div>
          )}

          {/* Video Controls (Mute & Quality) - Only show when sharing */}
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

              {/* Quality Selector */}
              <div className="relative">
                <button 
                  onClick={() => setShowQualityMenu(!showQualityMenu)}
                  className="bg-black/70 hover:bg-black/90 text-white px-3 py-3 rounded-full backdrop-blur-sm transition-all flex items-center gap-2"
                  title="Quality Settings"
                >
                  <Settings className="w-5 h-5" />
                  <span className="text-xs font-semibold">{qualityLabels[quality]}</span>
                </button>

                {/* Quality Menu */}
                {showQualityMenu && (
                  <div className="absolute bottom-full right-0 mb-2 bg-gray-800 rounded-lg shadow-lg border border-gray-700 overflow-hidden min-w-32">
                    {['auto', 'high', 'medium', 'low'].map((q) => (
                      <button
                        key={q}
                        onClick={() => changeQuality(q)}
                        className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                          quality === q 
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
          <button onClick={toggleFs} className="absolute top-4 right-4 bg-black/60 hover:bg-black/80 text-white p-3 rounded-full" style={{ zIndex: 25 }}>
            {isFs ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
        </div>

        <div className="bg-gray-800 p-3 border-t border-gray-700">
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
              {isHost && vidSrc === 'youtube' && !room?.isSharing && (
                <button 
                  onClick={togglePlay} 
                  className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm"
                >
                  {room?.isPlaying ? 'Pause' : 'Play'}
                </button>
              )}
            </div>
          </div>

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