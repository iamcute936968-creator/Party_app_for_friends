import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, X } from 'lucide-react';
import ChatMessage from './ChatMessage';

const emptyMessages = [];
const keyFor = (message) => message.id ?? `${message.timestamp}/${message.user}/${message.text}`;

function useNotices(roomId, messages, username) {
  const session = useRef(null);
  const [state, setState] = useState({ roomId, items: [], received: 0 });
  useEffect(() => {
    if (!session.current || session.current.roomId !== roomId) {
      session.current = { roomId, seen: new Set(messages.map(keyFor)) };
      setState({ roomId, items: [], received: 0 });
      return;
    }
    const current = session.current;
    const incoming = [];
    for (const message of messages) {
      const id = keyFor(message);
      if (current.seen.has(id)) continue;
      current.seen.add(id);
      if (message.type === 'user' && typeof message.text === 'string') incoming.push({ ...message, id, expiresAt: Date.now() + 6000 });
    }
    while (current.seen.size > 200) current.seen.delete(current.seen.values().next().value);
    if (incoming.length) setState((old) => ({ roomId, items: [...(old.roomId === roomId ? old.items : []), ...incoming].slice(-3),
      received: (old.roomId === roomId ? old.received : 0) + incoming.filter((message) => message.user !== username).length }));
  }, [roomId, messages, username]);
  useEffect(() => {
    if (state.roomId !== roomId || !state.items.length) return;
    const timer = setTimeout(() => setState((old) => ({ ...old, items: old.items.filter((message) => message.expiresAt > Date.now()) })),
      Math.max(1, Math.min(...state.items.map((message) => message.expiresAt)) - Date.now()));
    return () => clearTimeout(timer);
  }, [roomId, state]);
  return state.roomId === roomId ? state : { items: [], received: 0 };
}

export default function StageConversation({ roomId, username, messages = emptyMessages, draft = '', setDraft, send, status = 'idle', fullscreen = false, onOpenChange, typingIndicator, stopTyping, uid, editMessage, editStatus, loadVoice, offset = 0 }) {
  const [open, setOpen] = useState(false);
  const [readThrough, setReadThrough] = useState(0);
  const { items, received } = useNotices(roomId, messages, username);
  const list = useRef(null);
  const follow = useRef(true);
  const unread = open ? 0 : Math.min(99, Math.max(0, received - readThrough));
  useEffect(() => { onOpenChange?.(open); if (open) setReadThrough(received); }, [open, received, onOpenChange]);
  useEffect(() => { if (open && follow.current && list.current) list.current.scrollTop = list.current.scrollHeight; }, [open, messages]);
  const toggle = () => { follow.current = true; setOpen((value) => !value); };
  return <>
    <button className="stage-button stage-chat-toggle" aria-label={`${open ? 'Close' : 'Open'} on-screen chat${unread ? `, ${unread} unread messages` : ''}`}
      aria-expanded={open} onClick={toggle}><MessageSquare aria-hidden="true" /><span>Chat</span>{unread > 0 && <span className="stage-unread">{unread}</span>}</button>
    <div className="stage-message-notices" role="log" aria-label="On-screen messages" aria-live={fullscreen ? 'polite' : 'off'} aria-relevant="additions">
      {!open && items.map((message) => <p className="stage-message-notice" key={message.id}><strong>{message.user === username ? 'You' : message.user}</strong><span>{message.text}</span></p>)}
    </div>
    {open && <section className="stage-chat-panel" aria-label="On-screen chat">
      <div className="stage-chat-heading"><strong>Conversation</strong><button className="stage-button" aria-label="Close conversation" onClick={toggle}><X aria-hidden="true" /></button></div>
      <div ref={list} className="stage-chat-list" role="log" aria-label="On-screen conversation" aria-live="polite" aria-relevant="additions"
        onScroll={(event) => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48; }}>
        {messages.filter((message) => message.type === 'user').slice(-50).map((message) => <ChatMessage key={keyFor(message)} message={message} uid={uid} now={Date.now() + offset} editMessage={editMessage} editStatus={editStatus} loadVoice={loadVoice} compact />)}
      </div>
      {typingIndicator}
      <form className="stage-chat-composer" onSubmit={(event) => { event.preventDefault(); if (draft.trim() && status !== 'sending') void send?.(); }}>
        <label className="sr-only" htmlFor="stage-message">Message in video</label>
        <input id="stage-message" value={draft} onChange={(event) => setDraft?.(event.target.value)} onBlur={() => { void stopTyping?.(); }} placeholder="Message your room" maxLength={2000} enterKeyHint="send" autoComplete="off" />
        <button className="room-button room-button-primary" aria-label={status === 'error' ? 'Retry on-screen message' : 'Send on-screen message'} disabled={!draft.trim() || status === 'sending'}><Send aria-hidden="true" /></button>
      </form>
      {status !== 'idle' && <p className={`stage-chat-feedback ${status === 'error' ? 'stage-chat-error' : ''}`} role={status === 'error' ? 'alert' : 'status'} aria-label="On-screen message feedback">
        {status === 'error' ? 'Message not sent. Try again.' : status === 'sending' ? 'Sending...' : 'Sent'}</p>}
    </section>}
  </>;
}
