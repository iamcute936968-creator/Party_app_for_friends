import React from 'react';
import { Video, RefreshCw } from 'lucide-react';

export default function Home(props) {
  const {
    username,
    setUsername,
    roomId,
    setRoomId,
    loading,
    create,
    join,
    myAvatar,
    setMyAvatar,
    avOpts,
    lastHostRoom,
    rejoinAsHost
  } = props;

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-5xl mx-auto py-8">
        <div className="text-center mb-8 md:mb-12">
          <Video className="w-12 h-12 md:w-20 md:h-20 text-purple-300 mx-auto mb-6" />
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-3">Watch Party</h1>
          <p className="text-purple-200 text-lg">Watch together in real-time</p>
        </div>

        <div className="mb-8">
          <p className="text-white text-center mb-4">Choose avatar:</p>
          <div className="flex justify-center gap-3 flex-wrap">
            {avOpts.map((av, i) => (
              <button 
                key={i} 
                onClick={() => setMyAvatar(av)} 
                className={'text-4xl p-3 rounded-full transition-all ' + (myAvatar.emoji === av.emoji ? 'ring-4 ring-white scale-110' : 'hover:scale-110')} 
                style={{ backgroundColor: av.color + '40' }}
              >
                {av.emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Rejoin as Host Banner - Show if there's a saved room */}
        {lastHostRoom && (
          <div className="mb-6 bg-gradient-to-r from-green-500/20 to-emerald-500/20 backdrop-blur-lg rounded-2xl p-6 border border-green-500/30">
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1">
                <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                  <RefreshCw className="w-5 h-5" />
                  Rejoin Your Room
                </h3>
                <p className="text-green-200 text-sm">
                  Room ID: <span className="font-mono font-bold">{lastHostRoom.roomId}</span>
                </p>
                <p className="text-green-300/70 text-xs mt-1">
                  Created by: {lastHostRoom.hostName}
                </p>
              </div>
              <div className="flex flex-col gap-2 md:w-64">
                <input 
                  type="text" 
                  placeholder="Enter your name" 
                  value={username} 
                  onChange={(e) => setUsername(e.target.value)} 
                  onKeyPress={(e) => e.key === 'Enter' && username.trim() && rejoinAsHost()}
                  className="w-full px-4 py-2 rounded-lg bg-white/20 border border-green-400/30 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-green-400 text-sm" 
                />
                <button 
                  onClick={rejoinAsHost}
                  disabled={loading || !username.trim()}
                  className="bg-gradient-to-r from-green-500 to-emerald-500 text-white px-6 py-3 rounded-lg font-semibold hover:from-green-600 hover:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  {loading ? 'Rejoining...' : 'Rejoin as Host'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
            <h2 className="text-2xl font-bold text-white mb-6">Create Room</h2>
            <input 
              type="text" 
              placeholder="Enter your name" 
              value={username} 
              onChange={(e) => setUsername(e.target.value)} 
              onKeyPress={(e) => e.key === 'Enter' && create()} 
              className="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-white/60 mb-4 focus:outline-none focus:ring-2 focus:ring-purple-400" 
            />
            <button 
              onClick={create} 
              disabled={loading} 
              className="w-full bg-gradient-to-r from-purple-500 to-indigo-500 text-white py-3 rounded-lg font-semibold hover:from-purple-600 hover:to-indigo-600 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Room'}
            </button>
          </div>

          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
            <h2 className="text-2xl font-bold text-white mb-6">Join Room</h2>
            <input 
              type="text" 
              placeholder="Enter your name" 
              value={username} 
              onChange={(e) => setUsername(e.target.value)} 
              className="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-white/60 mb-4 focus:outline-none focus:ring-2 focus:ring-purple-400" 
            />
            <input 
              type="text" 
              placeholder="Enter Room ID" 
              value={roomId} 
              onChange={(e) => setRoomId(e.target.value)} 
              onKeyPress={(e) => e.key === 'Enter' && join()} 
              className="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-white/60 mb-4 focus:outline-none focus:ring-2 focus:ring-purple-400" 
            />
            <button 
              onClick={join} 
              disabled={loading} 
              className="w-full bg-gradient-to-r from-indigo-500 to-blue-500 text-white py-3 rounded-lg font-semibold hover:from-indigo-600 hover:to-blue-600 disabled:opacity-50"
            >
              {loading ? 'Joining...' : 'Join Room'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}