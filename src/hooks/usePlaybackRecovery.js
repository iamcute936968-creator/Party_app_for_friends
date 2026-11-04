import { useCallback, useEffect, useRef, useState } from 'react';
import { playbackFailure } from '../media/playbackFailure';

export function usePlaybackRecovery(scope, options) {
  const latest = useRef(options);
  latest.current = options;
  const session = useRef(null);
  const [state, setState] = useState({ error: null, phase: 'idle' });
  useEffect(() => {
    const current = { scope, active: true, pending: false, attempts: 0, timer: null, error: null, readyVersion: 0, activation: 0 };
    session.current = current;
    const clear = () => { clearTimeout(current.timer); current.timer = null; };
    const publish = (phase) => { if (current.active) setState({ error: current.error, phase }); };
    current.queue = () => {
      clear();
      if (!latest.current.enabled || !current.error?.retryable || current.attempts >= 3) { publish('error'); return; }
      publish('waiting');
      current.timer = setTimeout(() => current.run(true), 1000 * 2 ** current.attempts);
    };
    current.report = (failure) => {
      if (!current.active) return;
      current.error = failure;
      current.queue();
    };
    current.run = async (automatic, renewal = false) => {
      if (!scope || !current.active || current.pending || !latest.current.enabled) return;
      clear();
      if (!automatic) current.attempts = 0;
      if (!renewal) current.attempts += 1;
      current.pending = true;
      const version = current.readyVersion;
      const activation = current.activation;
      publish('recovering');
      try {
        const ok = await latest.current.refresh();
        if (!current.active || current.activation !== activation || current.readyVersion !== version) return;
        if (ok === false) current.report(current.error || playbackFailure('drive', 2));
        else {
          const timeout = Number.isFinite(latest.current.readyTimeout) ? Math.max(10000, Math.min(60000, latest.current.readyTimeout)) : 10000;
          current.timer = setTimeout(() => current.report(current.error || playbackFailure('drive', 2)), timeout);
        }
      } catch {
        if (current.active && current.activation === activation && current.readyVersion === version) current.report(current.error || playbackFailure('drive', 2));
      } finally { if (current.activation === activation) current.pending = false; }
    };
    current.ready = (playing) => {
      clear();
      current.readyVersion += 1;
      current.error = null;
      if (playing) current.attempts = 0;
      publish('idle');
    };
    current.clear = clear;
    setState({ error: null, phase: 'idle' });
    return () => { current.active = false; clear(); };
  }, [scope]);

  useEffect(() => {
    const current = session.current;
    if (!options.enabled) {
      current.activation += 1;
      current.pending = false;
      current.clear();
      setState({ error: current.error, phase: current.error ? 'error' : 'idle' });
    } else if (current.error) current.queue();
  }, [scope, options.enabled]);

  useEffect(() => {
    const current = session.current;
    if (!options.enabled || options.loading || current.error || !Number.isFinite(options.expiresAt)) return;
    const timer = setTimeout(() => {
      if (current.active && !current.pending && !current.error && latest.current.enabled && !latest.current.loading) void current.run(true, true);
    }, Math.max(1000, options.expiresAt - Date.now() - 30000));
    return () => clearTimeout(timer);
  }, [scope, options.enabled, options.loading, options.expiresAt]);

  const report = useCallback((failure) => { if (session.current?.scope === scope) session.current.report(failure); }, [scope]);
  const retry = useCallback(() => { if (session.current?.scope === scope) return session.current.run(false); }, [scope]);
  const ready = useCallback(() => { if (session.current?.scope === scope) session.current.ready(false); }, [scope]);
  const playing = useCallback(() => { if (session.current?.scope === scope) session.current.ready(true); }, [scope]);
  return { ...state, report, retry, ready, playing };
}
