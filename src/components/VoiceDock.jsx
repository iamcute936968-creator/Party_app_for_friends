import { Mic, MicOff } from 'lucide-react';
export default function VoiceDock({ voice, connectionStatus }) {
  if (!voice) return null;
  const active = voice.status === 'joined' || voice.status === 'reconnecting';
  return <section className="voice-dock" aria-label="Voice chat">
    <div className="voice-dock-actions">
      {active ? <>
        {voice.needsMicrophone && <button className="room-button room-button-primary" onClick={voice.join} disabled={connectionStatus !== 'connected'}>Resume microphone</button>}
        <button className="room-button room-button-secondary" onClick={voice.toggleMute} disabled={voice.needsMicrophone}><span aria-hidden="true">{voice.muted ? <MicOff /> : <Mic />}</span>{voice.muted ? 'Unmute microphone' : 'Mute microphone'}</button>
        <button className="room-button room-button-quiet" onClick={voice.leave}>Leave voice</button>
      </> : <button className="room-button room-button-secondary" onClick={voice.join} disabled={voice.status === 'starting' || connectionStatus !== 'connected'}><Mic aria-hidden="true" />{voice.status === 'starting' ? 'Joining voice...' : 'Join voice'}</button>}
      {voice.audioBlocked && <button className="room-button room-button-primary" onClick={voice.resumeAudio}>Enable voice audio</button>}
    </div>
    <p className="media-feedback" role="status" aria-label="Voice chat status">{voice.status === 'starting' ? 'Waiting for microphone permission...' : voice.status === 'reconnecting' ? (voice.needsMicrophone ? 'Voice stays open. Resume your microphone to continue.' : 'Reconnecting voice automatically. Your microphone setting is preserved.') : active ? (voice.muted ? 'Microphone muted.' : 'Microphone on.') : 'Your microphone stays off until you join voice.'}</p>
    {active && <details className="voice-options"><summary>Voice options</summary><div className="voice-diagnostics">
      <div className="voice-input"><span>{voice.muted ? 'Muted' : 'Mic input'}</span><meter min="0" max="100" value={voice.muted ? 0 : voice.inputLevel || 0} aria-label="Microphone input level" /></div>
      <p role="status" aria-label="Voice connection health">{voice.connection === 'connected' ? `Connected to ${voice.connectedPeers} ${voice.connectedPeers === 1 ? 'person' : 'people'}` : voice.connection === 'waiting' ? 'Waiting for others to join voice.' : 'Connecting to your room...'}{voice.quality === 'unstable' ? ' Network quality is unstable.' : voice.roundTripMs != null ? ` · ${voice.roundTripMs} ms` : ''}</p>
      {voice.relayStatus && <p className="media-feedback" role="status" aria-label="Voice network route">{voice.relayStatus === 'relay' ? 'Relay available for restricted networks.' : 'Direct connection. Relay is currently unavailable.'}</p>}
      <button className="room-button room-button-secondary" onClick={voice.reconnect}>Reconnect voice</button>
    </div></details>}
    {voice.error && <p className="room-error" role="alert">{voice.error}</p>}
  </section>;
}
