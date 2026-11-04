import { useEffect, useRef, useState } from 'react';
import { Pencil, Play } from 'lucide-react';
import { canEditMessage } from '../chat/messages';
import { validVoiceMetadata } from '../chat/voiceNotes';
function VoiceNote({ message, loadVoice }) {
  const [state, setState] = useState({ loading: false, url: '', error: '' });
  const alive = useRef(true), pending = useRef(false), resource = useRef(''), audio = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (resource.current) URL.revokeObjectURL(resource.current); }; }, []);
  useEffect(() => { const node = audio.current; return () => node?.pause?.(); }, [state.url]);
  const load = async () => {
    if (pending.current || !loadVoice) return;
    pending.current = true; setState(old => ({ ...old, loading: true, error: '' }));
    try {
      const blob = await loadVoice(message); if (!alive.current) return;
      if (resource.current) URL.revokeObjectURL(resource.current);
      resource.current = URL.createObjectURL(blob); setState({ loading: false, url: resource.current, error: '' });
    } catch { if (alive.current) setState(old => ({ ...old, loading: false, error: 'This voice note is unavailable or has expired.' })); }
    finally { pending.current = false; }
  };
  return <div className="chat-voice-note">
    {state.url ? <audio ref={audio} controls preload="none" src={state.url} aria-label={`Voice message from ${message.user}`} /> : <button className="room-button room-button-secondary" type="button" disabled={state.loading || !loadVoice} onClick={() => void load()}><Play aria-hidden="true" />{state.loading ? 'Loading recording…' : 'Play voice message'}</button>}
    <span>{Math.ceil(message.audio.durationMs / 1000)}s</span>{state.error && <p role="status">{state.error}</p>}
  </div>;
}
export default function ChatMessage({ message, uid, now, editMessage, editStatus, loadVoice, compact = false }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(''), [error, setError] = useState('');
  if (message.type === 'system') return <p className="system-message">{message.text}</p>;
  const editable = Boolean(editMessage && canEditMessage(message, uid, now));
  return <article className={`chat-bubble ${message.uid === uid ? 'chat-bubble-own' : ''} ${compact ? 'chat-bubble-compact' : ''}`}>
    <div className="chat-bubble-heading"><strong>{message.uid === uid ? 'You' : message.user}</strong><span>{message.time}{message.editedAt ? ' · Edited' : ''}</span>
      {editable && !editing && <button type="button" className="chat-edit-button" aria-label="Edit message" onClick={() => { setDraft(message.text); setEditing(true); setError(''); }}><Pencil aria-hidden="true" /></button>}
    </div>
    {editing ? <form className="chat-edit-form" onSubmit={async event => { event.preventDefault(); if (await editMessage(message, draft)) setEditing(false); else setError('The edit could not be saved. Your message is unchanged.'); }}>
      <label>Edit message text<textarea aria-label="Edit message text" value={draft} maxLength={2000} onChange={event => setDraft(event.target.value)} /></label>
      <div><button className="room-button room-button-primary" disabled={!draft.trim() || editStatus === 'saving'}>Save edit</button><button type="button" className="room-button room-button-quiet" onClick={() => setEditing(false)}>Cancel edit</button></div>
      {error && <p role="alert">{error}</p>}
    </form> : validVoiceMetadata(message.audio) ? <VoiceNote key={`${message.id}/${message.createdAt}`} message={message} loadVoice={loadVoice} /> : <p>{message.text}</p>}
  </article>;
}
