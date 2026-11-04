import { useCallback, useEffect, useRef, useState } from 'react';
import { ref, push, update, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { canEditMessage } from '../chat/messages';
import { chooseVoiceSlot, encodeVoiceBlob, readVoiceNote, validVoiceMetadata } from '../chat/voiceNotes';

export function useRoomChat(database, roomId, username, uid, options = {}) {
  const session = useRef(null);
  const latest = useRef(options); latest.current = options;
  const [state, setState] = useState({ roomId, username, draft: '', status: 'idle' });
  const [editState, setEditState] = useState({ status: 'idle', error: '' });

  useEffect(() => {
    const current = { roomId, username, uid, active: true, pending: false, editing: false, voicing: false, draft: '' };
    session.current = current;
    setState({ roomId, username, draft: '', status: 'idle' });
    setEditState({ status: 'idle', error: '' });
    return () => {
      current.active = false;
      if (session.current === current) session.current = null;
    };
  }, [database, roomId, username, uid]);

  const setDraft = useCallback((draft) => {
    const current = session.current;
    if (!current?.active || !current.roomId) return;
    current.draft = draft;
    setState({ roomId: current.roomId, username: current.username, draft, status: current.pending ? 'sending' : 'idle' });
  }, []);

  const send = useCallback(async () => {
    const current = session.current;
    if (!current?.active || !current.roomId || !current.username || current.pending || !current.draft.trim()) return;
    const draft = current.draft;
    current.pending = true;
    setState((previous) => ({ ...previous, status: 'sending' }));
    try {
      await push(ref(database, `/rooms/${current.roomId}/messages`), {
        ...(uid ? { uid } : {}), type: 'user', user: current.username, text: draft.trim(),
        time: new Date().toLocaleTimeString(), timestamp: Date.now(), createdAt: serverTimestamp(),
      });
      if (!current.active) return;
      const unchanged = current.draft === draft;
      if (unchanged) current.draft = '';
      setState({ roomId: current.roomId, username: current.username, draft: current.draft, status: unchanged ? 'sent' : 'idle' });
    } catch {
      if (current.active) setState((previous) => ({ ...previous, status: 'error' }));
    } finally {
      current.pending = false;
    }
  }, [database, uid]);

  const edit = useCallback(async (message, text) => {
    const current = session.current, now = Date.now() + (latest.current.clock?.current || 0);
    if (!current?.active || !current.roomId || current.editing || !canEditMessage(message, current.uid, now) || !/^[A-Za-z0-9_-]{1,128}$/.test(message.id || '') || typeof text !== 'string' || !text.trim() || text.trim().length > 2000) return false;
    current.editing = true; setEditState({ status: 'saving', error: '' });
    try {
      await update(ref(database, `/rooms/${current.roomId}/messages/${message.id}`), { text: text.trim(), editedAt: serverTimestamp() });
      if (!current.active) return false;
      setEditState({ status: 'idle', error: '' }); return true;
    } catch {
      if (current.active) setEditState({ status: 'error', error: 'Message could not be edited. The three-minute edit window may have ended.' });
      return false;
    } finally { current.editing = false; }
  }, [database]);

  const sendVoice = useCallback(async ({ blob, mimeType, durationMs }) => {
    const current = session.current;
    if (!current?.active || !current.roomId || !current.uid || !current.username || current.voicing || !validVoiceMetadata({ slot: '0', mimeType, bytes: blob?.size, durationMs })) return false;
    current.voicing = true;
    try {
      const data = await encodeVoiceBlob(blob);
      if (!current.active || session.current !== current) return false;
      const retained = latest.current.recordsRef?.current;
      if (latest.current.recordsRef && retained?.roomId !== current.roomId) return false;
      const records = retained?.roomId === current.roomId ? retained.messages : Object.values(latest.current.messages || {});
      const slot = chooseVoiceSlot(records, current.uid, Date.now() + (latest.current.clock?.current || 0));
      if (slot === null) return false;
      const id = push(ref(database, `/rooms/${current.roomId}/messages`)).key;
      if (!id || !/^[A-Za-z0-9_-]{20}$/.test(id)) return false;
      const audio = { slot, mimeType, bytes: blob.size, durationMs }, createdAt = serverTimestamp();
      await update(ref(database, '/'), {
        [`rooms/${current.roomId}/messages/${id}`]: { uid: current.uid, type: 'user', user: current.username, text: 'Voice message', time: new Date().toLocaleTimeString(), timestamp: Date.now(), createdAt, audio },
        [`roomVoiceNotes/${current.roomId}/${slot}`]: { uid: current.uid, messageId: id, data, mimeType, bytes: blob.size, durationMs, createdAt },
      });
      return current.active && session.current === current;
    } catch { return false; } finally { current.voicing = false; }
  }, [database]);
  const loadVoice = useCallback(async message => {
    const current = session.current;
    if (!current?.active || !current.roomId || !current.uid) throw Error('Voice note unavailable.');
    const blob = await readVoiceNote(database, current.roomId, message);
    if (!current.active || session.current !== current) throw Error('Voice note unavailable.');
    return blob;
  }, [database]);
  const clearVoice = useCallback(async () => {
    const current = session.current;
    if (!current?.active || !current.roomId || !current.uid || !latest.current.isHost || current.clearing) return false;
    const retained = latest.current.recordsRef?.current;
    if (latest.current.recordsRef && retained?.roomId !== current.roomId) return false;
    current.clearing = true;
    try {
      const paths = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`roomVoiceNotes/${current.roomId}/${i}`, null]));
      if (retained?.roomId === current.roomId) for (const message of retained.messages) {
        if (message.type === 'user' && validVoiceMetadata(message.audio) && /^[A-Za-z0-9_-]{1,128}$/.test(message.id || '')) paths[`rooms/${current.roomId}/messages/${message.id}`] = null;
      }
      await update(ref(database, '/'), paths);
      return current.active && session.current === current;
    } catch { return false; } finally { current.clearing = false; }
  }, [database]);

  const visible = state.roomId === roomId && state.username === username;
  return { draft: visible ? state.draft : '', status: visible ? state.status : 'idle', setDraft, send, edit, editStatus: editState.status, editError: editState.error, sendVoice, loadVoice, clearVoice };
}
