import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_DURATION = 15000, MAX_BYTES = 128 * 1024;
const initial = scope => ({ scope, status: 'idle', error: '', previewUrl: '', durationMs: 0 });
const stopTracks = stream => { for (const track of stream?.getTracks?.() || []) { try { track.stop(); } catch { /* Release the remaining owned tracks. */ } } };
function clearTimers(current) {
  clearTimeout(current.limitTimer); clearInterval(current.tickTimer); clearTimeout(current.finishTimer);
}
function release(current) {
  ++current.generation; clearTimers(current);
  const recorder = current.recorder; current.recorder = null;
  if (recorder) {
    recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
    try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* Tracks are released below. */ }
  }
  stopTracks(current.stream); current.stream = null;
  if (current.previewUrl) { try { URL.revokeObjectURL(current.previewUrl); } catch { /* The preview is already unavailable. */ } }
  current.previewUrl = ''; current.blob = null; current.chunks = []; current.bytes = 0; current.stopping = false;
}
function recorderSupport(getStream) {
  const Recorder = globalThis.MediaRecorder;
  if (typeof Recorder !== 'function' || typeof Recorder.isTypeSupported !== 'function' ||
    (!getStream && !navigator.mediaDevices?.getUserMedia) || typeof URL.createObjectURL !== 'function') return null;
  try {
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => Recorder.isTypeSupported(type));
    return mimeType ? { Recorder, mimeType } : null;
  } catch { return null; }
}

// A supplied getStream must return owned tracks, e.g. fresh clones of live-chat tracks.
export function useVoiceRecorder({ scope, onSend, getStream, enabled = true }) {
  const currentSession = useRef(null), latest = useRef(null);
  latest.current = { onSend, getStream, enabled };
  const [view, setView] = useState(() => initial(scope));
  const alive = useCallback((current, generation = current?.generation) => Boolean(current?.active && currentSession.current === current && current.scope === scope && current.generation === generation), [scope]);
  const publish = useCallback((current, update) => {
    if (!alive(current)) return;
    if (update.status) current.status = update.status;
    setView(previous => ({ ...(previous.scope === scope ? previous : initial(scope)), ...update, scope }));
  }, [scope, alive]);
  const reset = useCallback((current, error = '') => {
    if (!alive(current)) return;
    release(current); publish(current, { ...initial(scope), error });
  }, [scope, alive, publish]);
  useEffect(() => {
    const current = { scope, active: true, generation: 0, status: 'idle', previewUrl: '', chunks: [] };
    currentSession.current = current; setView(initial(scope));
    return () => { current.active = false; release(current); if (currentSession.current === current) currentSession.current = null; };
  }, [scope]);

  const stopCurrent = useCallback((current, generation) => {
    if (!alive(current, generation) || current.status !== 'recording' || current.stopping || !current.recorder) return false;
    current.stopping = true; current.stoppedAt = Date.now(); clearTimers(current);
    try { current.recorder.stop(); }
    catch { reset(current, 'Recording could not finish. Please try again.'); return false; }
    if (alive(current, generation) && current.stopping) current.finishTimer = setTimeout(() => {
      if (alive(current, generation)) reset(current, 'Recording could not finish. Please try again.');
    }, 1500);
    return true;
  }, [alive, reset]);
  const start = useCallback(async () => {
    const current = currentSession.current;
    if (!scope || !alive(current) || current.status !== 'idle' || !latest.current.enabled) return false;
    const support = recorderSupport(latest.current.getStream);
    if (!support) { publish(current, { error: 'Voice recording is not supported in this browser.' }); return false; }
    const generation = ++current.generation;
    publish(current, { status: 'acquiring', error: '', durationMs: 0, previewUrl: '' });
    let owned;
    try {
      owned = latest.current.getStream ? await latest.current.getStream() : await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
      if (!alive(current, generation)) { stopTracks(owned); return false; }
      current.stream = owned;
      if (!owned?.getAudioTracks?.().some(track => track.readyState !== 'ended')) throw Error('No audio track');
      const recorder = new support.Recorder(owned, { mimeType: support.mimeType, audioBitsPerSecond: 32000 });
      current.recorder = recorder; current.bytes = 0; current.chunks = []; current.startedAt = Date.now(); current.stoppedAt = null; current.stopping = false;
      const mimeType = recorder.mimeType || support.mimeType;
      if (!['audio/webm', 'audio/mp4', 'audio/ogg'].includes(mimeType.split(';')[0])) throw Error('Unsupported recording');
      recorder.ondataavailable = event => {
        if (!alive(current, generation) || !(event.data instanceof Blob) || event.data.size === 0) return;
        if (current.bytes + event.data.size > MAX_BYTES) { reset(current, 'Recording is too large. Try a shorter voice note.'); return; }
        current.bytes += event.data.size; current.chunks.push(event.data);
      };
      recorder.onerror = () => { if (alive(current, generation)) reset(current, 'Recording failed. Please try again.'); };
      recorder.onstop = () => {
        if (!alive(current, generation)) return;
        clearTimers(current); recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null; current.recorder = null;
        stopTracks(current.stream); current.stream = null; current.stopping = false;
        try {
          const durationMs = Math.round((current.stoppedAt ?? Date.now()) - current.startedAt);
          if (durationMs < 0 || durationMs > MAX_DURATION) { reset(current, 'Recording exceeded the 15-second limit. Please try again.'); return; }
          const blob = new Blob(current.chunks, { type: mimeType }); current.chunks = [];
          if (!blob.size || blob.size > MAX_BYTES) { reset(current, 'No usable audio was recorded. Please try again.'); return; }
          current.blob = blob; current.mimeType = mimeType;
          current.durationMs = Math.max(1, durationMs);
          current.previewUrl = URL.createObjectURL(blob);
          publish(current, { status: 'preview', error: '', previewUrl: current.previewUrl, durationMs: current.durationMs });
        } catch { reset(current, 'Recording could not be prepared. Please try again.'); }
      };
      recorder.start(250); publish(current, { status: 'recording' });
      // Leave a little scheduling headroom; delayed/background stops still fail the bound above.
      current.limitTimer = setTimeout(() => { stopCurrent(current, generation); }, MAX_DURATION - 100);
      current.tickTimer = setInterval(() => {
        if (alive(current, generation) && !current.stopping) publish(current, { durationMs: Math.min(MAX_DURATION, Math.max(0, Date.now() - current.startedAt)) });
      }, 250);
      return true;
    } catch {
      if (alive(current, generation)) reset(current, 'Could not access your microphone. Check permission and try again.');
      else if (owned && current.stream !== owned) stopTracks(owned);
      return false;
    }
  }, [scope, alive, publish, reset, stopCurrent]);
  const stop = useCallback(() => { const current = currentSession.current; return stopCurrent(current, current?.generation); }, [stopCurrent]);
  const cancel = useCallback(() => { const current = currentSession.current; if (alive(current)) reset(current); }, [alive, reset]);
  const send = useCallback(async () => {
    const current = currentSession.current;
    if (!alive(current) || current.status !== 'preview' || !current.blob) return false;
    if (!latest.current.enabled) { publish(current, { error: 'Reconnect before sending this voice note.' }); return false; }
    const generation = current.generation, callback = latest.current.onSend;
    publish(current, { status: 'sending', error: '' });
    try {
      const acknowledged = typeof callback === 'function' && await callback({ blob: current.blob, mimeType: current.mimeType, durationMs: current.durationMs });
      if (!alive(current, generation)) return false;
      if (acknowledged === true) { reset(current); return true; }
    } catch { /* Keep the local preview available for a deliberate retry. */ }
    if (alive(current, generation)) publish(current, { status: 'preview', error: 'Voice note could not be sent. Please try again.' });
    return false;
  }, [alive, publish, reset]);
  const visible = view.scope === scope ? view : initial(scope);
  return { status: visible.status, error: visible.error, previewUrl: visible.previewUrl, durationMs: visible.durationMs, supported: Boolean(recorderSupport(getStream)), start, stop, cancel, send };
}
