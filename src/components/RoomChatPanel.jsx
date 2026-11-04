import { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, Square, Send, X } from 'lucide-react';
import ChatMessage from './ChatMessage';
import VoiceDock from './VoiceDock';
import TypingIndicator from './TypingIndicator';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import './RoomChatPanel.css';
export default function RoomChatPanel({ active, room, messages, username, uid, draft, setDraft, send, status, editMessage, editStatus, editError, sendVoice, loadVoice, clearVoice, voice, connected, participantFeatures, participants, offset = 0 }) {
  const list = useRef(null), following = useRef(true);
  const [now, setNow] = useState(Date.now() + offset);
  const [cleanup, setCleanup] = useState('idle');
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now() + offset), 1000); return () => clearInterval(timer); }, [active, offset]);
  useEffect(() => { if (active && following.current && list.current) list.current.scrollTop = list.current.scrollHeight; }, [active, messages]);
  const getStream = useCallback(async () => voice?.recordingStream?.() || navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }), [voice]);
  const recorder = useVoiceRecorder({ scope: `${room?.id}/${uid || ''}`, onSend: sendVoice, getStream, enabled: connected && Boolean(uid && sendVoice) });
  const { status: recordingStatus, stop, cancel } = recorder;
  useEffect(() => { if (!active && recordingStatus === 'recording') stop(); if (!active && recordingStatus === 'acquiring') cancel(); }, [active, recordingStatus, stop, cancel]);
  return <section className="room-chat-panel" aria-label="Room conversation">
    <header className="chat-panel-heading"><div><h2>Conversation</h2><p>Edit your own text within three minutes.</p></div><VoiceDock voice={voice} connectionStatus={connected ? 'connected' : 'disconnected'} /></header>
    <div ref={list} className="chat-message-list" role="log" aria-label="Recent messages" aria-live={active ? 'polite' : 'off'} aria-relevant="additions text" onScroll={event => { const node = event.currentTarget; following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48; }}>
      {!messages.length && <p className="conversation-empty">Your room, your conversation.<br />Say hello, even when nothing is playing.</p>}
      {messages.map((message, index) => <ChatMessage key={message.id ?? index} message={message} uid={uid} now={now} editMessage={editMessage} editStatus={editStatus} loadVoice={loadVoice} />)}
    </div>
    <TypingIndicator records={room?.typing} participants={participants} username={username} offset={offset} />
    <div className="chat-composer-area">
      <form className="message-composer" onSubmit={event => { event.preventDefault(); if (draft.trim() && status !== 'sending') void send?.(); }}>
        <label className="sr-only" htmlFor="chat-message">Message</label><input id="chat-message" maxLength={2000} value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => { void participantFeatures?.stopTyping(); }} placeholder="Send a message…" autoComplete="off" enterKeyHint="send" />
        <button className="room-button room-button-primary" aria-label={status === 'error' ? 'Retry message' : 'Send message'} disabled={!draft.trim() || status === 'sending' || !connected}><Send aria-hidden="true" /></button>
        {['idle', 'acquiring'].includes(recorder.status) && <button className="room-button room-button-secondary" type="button" aria-label="Record voice note" disabled={!recorder.supported || !connected || !uid || recorder.status === 'acquiring'} onClick={() => void recorder.start()}><Mic aria-hidden="true" /></button>}
        {recorder.status === 'recording' && <button className="room-button room-button-primary" type="button" onClick={recorder.stop}><Square aria-hidden="true" />Stop recording</button>}
      </form>
      {recorder.status === 'recording' && <p role="status">Recording {Math.ceil(recorder.durationMs / 1000)} / 15s</p>}
      {recorder.previewUrl && <div className="voice-note-preview" aria-label="Voice note preview"><audio controls src={recorder.previewUrl} aria-label="Preview recording" /><div><button className="room-button room-button-quiet" type="button" disabled={recorder.status === 'sending'} onClick={recorder.cancel}><X aria-hidden="true" />Cancel recording</button><button className="room-button room-button-primary" type="button" disabled={recorder.status === 'sending' || !connected} onClick={() => void recorder.send()}><Send aria-hidden="true" />{recorder.status === 'sending' ? 'Sending recording…' : 'Send recording'}</button></div></div>}
      <p className="voice-note-hint">Voice notes: up to 15s. Playback expires after 24 hours; older recordings may be replaced.</p>
      {clearVoice && <div className="voice-note-cleanup">{cleanup === 'confirm' ? <><p>Remove all stored voice notes and their messages from this room? This frees recording space for everyone.</p><button className="room-button room-button-secondary" type="button" onClick={async () => { setCleanup('pending'); setCleanup(await clearVoice() ? 'done' : 'error'); }}>Confirm recording cleanup</button><button className="room-button room-button-quiet" type="button" onClick={() => setCleanup('idle')}>Cancel cleanup</button></> : <button className="room-button room-button-quiet" type="button" disabled={!connected || cleanup === 'pending'} onClick={() => setCleanup('confirm')}>{cleanup === 'pending' ? 'Clearing recordings…' : 'Clear stored voice notes'}</button>}
        {cleanup === 'done' && <p role="status">Stored voice notes cleared.</p>}{cleanup === 'error' && <p role="alert">Recordings could not be cleared. Try again.</p>}</div>}
      {recorder.error && <p className="room-error" role="alert">{recorder.error}</p>}{editError && <p className="room-error" role="alert">{editError}</p>}
      {status === 'error' ? <p className="room-error" role="alert">Message not sent. Try again.</p> : status !== 'idle' && <p className="chat-feedback" role="status">{status === 'sending' ? 'Sending…' : 'Sent'}</p>}
    </div>
  </section>;
}
