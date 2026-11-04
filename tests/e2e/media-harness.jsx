// Browser-only component integration harness; never imported by the production app.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Room from '../../src/components/Room';
import { createHTML5Adapter } from '../../src/adapters/HTML5Adapter';
import '../../src/index.css';

export default function PlaybackHarness() {
  const video = useRef(null);
  const adapter = useRef(null);
  const container = useRef(null);
  const shareVideo = useRef(null);
  const [playbackState, setPlaybackState] = useState('PAUSED');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const player = createHTML5Adapter(video.current, '/__test/playback.mp4');
    player.onReady(() => setReady(true));
    player.onStateChange(setPlaybackState);
    adapter.current = player;
    return () => player.destroy({ revokeObjectUrl: false });
  }, []);
  return <Room room={{ id: 'LOCAL_QA', roomName: 'Local playback', host: 'Host', playbackState }}
    isHost participants={['Host']} connectionStatus="connected" messages={[]} floatMsgs={[]}
    containerRef={container} vidRef={shareVideo} driveVideoRef={video} videoId="local-clip"
    vidSrc="drive" isStreaming driveLoading={!ready} ytUrl="" msgInput=""
    setYtUrl={() => {}} setMsgInput={() => {}} copy={() => {}} leave={() => {}} load={() => {}}
    startShare={() => {}} toggleFs={() => {}} sendMsg={() => {}}
    togglePlay={() => playbackState === 'PLAYING' ? adapter.current.pause() : adapter.current.play()}
    onDriveSeekStart={() => adapter.current.pause()} onDriveSeekCommit={(time) => adapter.current.seek(time)} />;
}
createRoot(document.getElementById('root')).render(<PlaybackHarness />);
