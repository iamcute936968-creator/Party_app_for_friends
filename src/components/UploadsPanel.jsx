import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, FolderLock } from 'lucide-react';
import { createAnimeRequest } from '../anime/api';
import { useDriveUploadAuth } from '../hooks/useDriveUploadAuth';
import { listUploadedVideos, shareUploadedVideo, uploadDriveVideo } from '../uploads/driveUpload';
import './UploadsPanel.css';

export default function UploadsPanel({ account, library, roomId = '', canChoose = false, onChoose,
  proxyUrl = import.meta.env.VITE_MEDIA_PROXY_URL || '' }) {
  const uid = account?.user && !account.user.isAnonymous ? account.user.uid : null;
  const auth = useDriveUploadAuth({ accountUid: uid, loginHint: account?.user?.email });
  const request = useMemo(() => createAnimeRequest({ proxyUrl, timeoutMs: 8000 }), [proxyUrl]);
  const [config, setConfig] = useState(null);
  const [connected, setConnected] = useState(false);
  const [items, setItems] = useState([]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const operation = useRef(null);
  const input = useRef(null);
  const latest = useRef({ uid, roomId, canChoose });
  latest.current = { uid, roomId, canChoose };
  useEffect(() => {
    const controller = new AbortController();
    setConfig(null);
    if (uid) request('/api/uploads/config', controller.signal).then(value => {
      if (controller.signal.aborted) return;
      const valid = value?.enabled === true && typeof value.readerEmail === 'string' && value.readerEmail.length <= 254 &&
        /^[A-Za-z0-9._+-]+@(?:[A-Za-z0-9-]+\.)+gserviceaccount\.com$/.test(value.readerEmail);
      setConfig(valid ? { readerEmail: value.readerEmail } : false);
    }).catch(() => { if (!controller.signal.aborted) setConfig(false); });
    return () => { controller.abort(); operation.current?.abort(); };
  }, [request, uid]);
  const run = async (label, action) => {
    if (operation.current || !uid || !config) return;
    const controller = new AbortController(); operation.current = controller;
    const current = { uid, roomId };
    const active = () => !controller.signal.aborted && latest.current.uid === current.uid && latest.current.roomId === current.roomId;
    setBusy(label); setError(''); setNotice('');
    try {
      // Invoked directly by the click handler so GIS retains its user gesture.
      const token = await auth.authorize();
      if (!active()) return;
      await action({ token, signal: controller.signal, active });
    } catch (reason) {
      if (active() && reason?.name !== 'AbortError') setError(reason?.message || 'Could not complete the video operation. Please try again.');
    } finally {
      if (operation.current === controller) operation.current = null;
      if (active()) setBusy('');
    }
  };
  if (!uid) return <section className="uploads-panel" aria-label="Private video uploads"><h2><FolderLock aria-hidden="true" />Your uploads</h2>
    <p>Sign in with Google on the Account page to upload your own videos.</p></section>;
  return <section className="uploads-panel" aria-label="Private video uploads">
    <h2><FolderLock aria-hidden="true" />Your uploads</h2>
    <p>Upload videos you own or have permission to share. Files use your Google Drive storage and stay private until you share them with a room.</p>
    {config === null ? <p role="status">Checking upload availability…</p> : config === false ? <p role="status">Uploads are unavailable right now. Please try again later.</p> : <>
      {!connected ? <button type="button" className="room-button room-button-secondary" disabled={!auth.ready || !!busy} onClick={() => run('connect', async ({ token, signal, active }) => {
        const videos = await listUploadedVideos({ ownerUid: uid, token, signal });
        if (active()) { setItems(videos); setConnected(true); }
      })}>{busy === 'connect' ? 'Connecting…' : 'Connect Google Drive'}</button> : <>
        <form className="uploads-form" onSubmit={event => { event.preventDefault(); if (!file) return; run('upload', async ({ token, signal, active }) => {
          setProgress(0);
          const video = await uploadDriveVideo({ file, ownerUid: uid, token, signal, onProgress: value => { if (active()) setProgress(value); } });
          if (!active()) return;
          setItems(previous => [video, ...previous.filter(item => item.id !== video.id)].slice(0, 50));
          if (!library?.items?.some(item => item.source === 'drive' && item.id === video.id && item.wishlist)) await library?.toggle?.(video);
          if (!active()) return;
          setNotice('Uploaded to your private Google Drive. Share it from inside a room when you are ready.');
          setFile(null); if (input.current) input.current.value = '';
        }); }}>
          <label>Video file<input ref={input} type="file" accept="video/mp4,video/webm" disabled={!!busy} onChange={event => setFile(event.target.files?.[0] || null)} /></label>
          <span className="uploads-help">MP4 or WebM, up to 2 GiB. MP4 with H.264 video and AAC audio works best across phones.</span>
          <button className="room-button room-button-secondary" type="submit" disabled={!file || !!busy || !auth.ready}><Upload aria-hidden="true" />{busy === 'upload' ? `Uploading ${progress}%` : 'Upload privately'}</button>
        </form>
        {busy === 'upload' && <progress aria-label="Upload progress" value={progress} max="100" />}
        {!items.length && <p>No uploaded videos yet.</p>}
        <ul className="uploads-list">{items.map(item => <li key={item.id}><div><strong>{item.title}</strong><span>{(item.size / 1048576).toFixed(1)} MB · Private upload</span></div>
          {roomId && <button type="button" className="room-button room-button-secondary" disabled={!canChoose || !!busy || !auth.ready} aria-label={`Share ${item.title} with this room`} onClick={() => run('share', async ({ token, signal, active }) => {
            const media = await shareUploadedVideo({ id: item.id, ownerUid: uid, roomId, readerEmail: config.readerEmail, token, signal });
            if (active() && latest.current.canChoose) await onChoose?.(media);
            if (active()) setNotice('Video shared with this room. Sharing with another room will replace this room’s access.');
          })}>Share with this room</button>}</li>)}</ul>
        {roomId && <p className="uploads-help">Sharing grants the Watch Party playback service reader access. It never makes your file public. Manage or remove that permission in Google Drive.</p>}
      </>}
      {busy && <button className="room-button room-button-quiet" type="button" onClick={() => { operation.current?.abort(); operation.current = null; setBusy(''); setNotice('Cancelled. A partial file may remain in your Google Drive.'); }}>Cancel</button>}
    </>}
    {(error || auth.error) && <p role="alert">{error || auth.error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
