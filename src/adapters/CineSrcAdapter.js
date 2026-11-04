import { movieSelection } from '../movies/selection';
const ORIGIN = 'https://cinesrc.st';
const durationOk = value => Number.isFinite(value) && value > 0 && value <= 604800;
export function cineSrcEmbedUrl(value, position = 0) {
  const item = movieSelection(value, true); if (!item) return '';
  const query = new URLSearchParams({ autoplay: 'false', autonext: 'false', autoskip: 'false', color: '#e95c4c' });
  if (item.kind === 'tv') { query.set('s', item.season); query.set('e', item.episode); }
  if (Number.isFinite(position) && position > 0 && position <= 604800) query.set('startAt', String(Math.floor(position)));
  return `${ORIGIN}/embed/${item.kind}/${item.id}?${query}`;
}
// Public protocol: https://cinesrc.st/docs. No cross-origin DOM access is used.
export function createCineSrcAdapter(frame) {
  let destroyed = false, ready = false, position = 0, duration = NaN, state = 'UNSTARTED';
  let readyCb, stateCb, errorCb, seekCb, metadataCb, bufferingCb;
  let playingIntent = false, seeking = false, seekTarget = null, lastProgress = 0, lastAdvanceAt = Date.now(), bufferSince = 0, stallReported = false;
  const send = (command, args = []) => { if (!destroyed) frame?.postMessage({ type: 'cinesrc:command', command, args }, ORIGIN); };
  const markReady = () => { if (!ready && !destroyed) { ready = true; state = 'PAUSED'; clearTimeout(deadline); if (playingIntent) change('BUFFERING'); readyCb?.(); } };
  const progress = data => Number.isFinite(data.currentTime) && data.currentTime >= 0 && durationOk(data.duration) && data.currentTime <= data.duration + 2;
  const change = next => {
    if (next === state) return;
    const buffering = state === 'BUFFERING'; state = next;
    if (next === 'BUFFERING') { bufferSince = Date.now(); stallReported = false; }
    if (buffering !== (next === 'BUFFERING')) bufferingCb?.(next === 'BUFFERING');
    if (next !== 'BUFFERING') stateCb?.(next);
  };
  const finishSeek = () => { if (!seeking) return; seeking = false; seekTarget = null; lastProgress = position; if (!playingIntent) change('PAUSED'); seekCb?.(); };
  const receive = event => {
    if (destroyed || event.source !== frame || event.origin !== ORIGIN || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return;
    const data = event.data;
    switch (data.type) {
      case 'cinesrc:ready': markReady(); break;
      case 'cinesrc:loadedmetadata': if (durationOk(data.duration)) { const notify = ready; duration = data.duration; markReady(); if (notify) metadataCb?.(); } break;
      case 'cinesrc:timeupdate':
      case 'cinesrc:seeked':
      case 'cinesrc:seeking': {
        if (!progress(data)) return;
        const advanced = data.currentTime > lastProgress + .01, metadataMissing = !durationOk(duration), wasSeeking = seeking;
        position = Math.min(data.currentTime, data.duration); duration = data.duration;
        lastProgress = position;
        if (metadataMissing && ready) metadataCb?.();
        if (data.type === 'cinesrc:seeking') { seeking = true; seekTarget ??= position; if (ready) change('BUFFERING'); }
        if (data.type === 'cinesrc:seeked') { if (seeking) finishSeek(); else seekCb?.(); }
        if (data.type === 'cinesrc:timeupdate' && seeking && seekTarget !== null && Math.abs(position - seekTarget) < 1) finishSeek();
        if (data.type === 'cinesrc:timeupdate' && playingIntent && !wasSeeking && !seeking && advanced) { lastAdvanceAt = Date.now(); change('PLAYING'); }
        break;
      }
      case 'cinesrc:play': playingIntent = true; lastAdvanceAt = Date.now(); if (ready) change('BUFFERING'); break;
      case 'cinesrc:pause': if (seeking || (state === 'BUFFERING' && playingIntent)) return; playingIntent = false; if (ready) change('PAUSED'); break;
      case 'cinesrc:ended': playingIntent = false; seeking = false; if (ready) { if (durationOk(duration)) position = duration; change('ENDED'); } break;
      case 'cinesrc:response':
        if (data.command === 'getDuration' && durationOk(data.result)) { const notify = ready && !durationOk(duration); duration = data.result; markReady(); if (notify) metadataCb?.(); }
        if (data.command === 'getCurrentTime' && Number.isFinite(data.result) && data.result >= 0 && data.result <= (durationOk(duration) ? duration + 2 : 604800)) {
          position = Math.min(data.result, durationOk(duration) ? duration : 604800);
          if (seeking && !playingIntent && seekTarget !== null && Math.abs(position - seekTarget) < 1) finishSeek();
        }
        break;
      case 'cinesrc:error': errorCb?.({ code: 'unavailable' }); break;
      case 'cinesrc:nextepisode': send('pause'); errorCb?.({ code: 'selection-changed' }); break;
    }
  };
  const poll = () => {
    send('getCurrentTime'); send('getDuration');
    if (ready && playingIntent && Date.now() - lastAdvanceAt > 4000) change('BUFFERING');
    if (state === 'BUFFERING' && !stallReported && Date.now() - bufferSince >= 60000) { stallReported = true; errorCb?.({ code: 'unavailable' }); }
  };
  window.addEventListener('message', receive);
  const deadline = setTimeout(() => { if (!ready && !destroyed) errorCb?.({ code: 'unavailable' }); }, 60000);
  const timer = setInterval(poll, 1000);
  return {
    getCurrentTime: () => position, getDuration: () => duration, getState: () => state,
    play() { playingIntent = true; lastAdvanceAt = Date.now(); if (ready) change('BUFFERING'); send('play'); },
    pause() { playingIntent = false; send('pause'); },
    seek(time) { if (Number.isFinite(time) && time >= 0 && time <= 604800) { seeking = true; seekTarget = Math.min(time, durationOk(duration) ? duration : time); lastAdvanceAt = Date.now(); if (ready) change('BUFFERING'); send('seek', [seekTarget]); } },
    onReady(cb) { readyCb = cb; }, onStateChange(cb) { stateCb = cb; }, onError(cb) { errorCb = cb; }, onSeek(cb) { seekCb = cb; }, onMetadata(cb) { metadataCb = cb; },
    onBufferingChange(cb) { bufferingCb = cb; },
    destroy() { if (destroyed) return; send('pause'); destroyed = true; clearTimeout(deadline); clearInterval(timer); window.removeEventListener('message', receive); readyCb = stateCb = errorCb = seekCb = metadataCb = bufferingCb = null; },
  };
}
