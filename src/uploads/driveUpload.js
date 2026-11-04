import { parseMediaLink } from '../library/viewingLibrary';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const CHUNK = 1024 * 1024;
const MAX_SIZE = 2 * 1024 ** 3;
const UPLOAD_ERROR = 'Your video upload could not finish. Please try again.';
const SHARE_ERROR = 'Your uploaded video could not be shared. Please try again.';
class UserError extends Error {}
const fail = message => { throw new UserError(message); };
const canonicalId = id => typeof id === 'string' && parseMediaLink(`https://drive.google.com/file/d/${encodeURIComponent(id)}/view`)?.id === id;
const validUid = uid => typeof uid === 'string' && uid.length > 0 && uid.length <= 128 && !uid.split('').some(char =>
  '.#$[]/'.includes(char) || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const control = char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127;
const titleOf = name => (typeof name === 'string' ? Array.from(name).filter(char => !control(char)).join('').trim().slice(0, 120) : '') || 'Uploaded video';

function active(signal) {
  if (signal?.aborted) throw new DOMException('Video operation cancelled.', 'AbortError');
}

function credentials(ownerUid, token, fetchFn) {
  if (!validUid(ownerUid)) fail('A valid account is required to upload or share videos.');
  if (typeof token !== 'string' || !token || token.length > 8192 || /\s/.test(token) || Array.from(token).some(control)) fail('Authorize Google Drive before continuing.');
  if (typeof fetchFn !== 'function') fail(UPLOAD_ERROR);
}

async function ownerDigest(ownerUid) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ownerUid));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function request(fetchFn, url, { token, signal, method = 'GET', headers = {}, body } = {}) {
  active(signal);
  const response = await fetchFn(url, { method, signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    referrerPolicy: 'no-referrer', headers: { Authorization: `Bearer ${token}`, ...headers }, ...(body === undefined ? {} : { body }) });
  active(signal);
  return response;
}

async function data(response, signal, message) {
  if (!response?.ok) fail(message);
  const value = await response.json();
  active(signal);
  return value;
}

function sessionLocation(value) {
  const url = new URL(value);
  if (url.origin !== 'https://www.googleapis.com' || url.username || url.password || url.hash ||
    url.pathname !== '/upload/drive/v3/files' || url.searchParams.getAll('uploadType').length !== 1 ||
    url.searchParams.get('uploadType') !== 'resumable' || url.searchParams.getAll('upload_id').length !== 1 ||
    !url.searchParams.get('upload_id')) fail(UPLOAD_ERROR);
  return url.href;
}

function acknowledged(response, offset, sent, total) {
  const range = response.headers.get('Range');
  const match = range?.match(/^bytes=0-(\d+)$/);
  const next = range === null ? 0 : match ? Number(match[1]) + 1 : NaN;
  if (!Number.isSafeInteger(next) || next < offset || next > sent || next > total) fail(UPLOAD_ERROR);
  return next;
}

function safeError(error, signal, fallback) {
  active(signal);
  if (error?.name === 'AbortError') return new DOMException('Video operation cancelled.', 'AbortError');
  return error instanceof UserError ? error : new Error(fallback);
}

/** Latest 50 owned app uploads; no stored tokens, arbitrary query or public files. */
export async function listUploadedVideos({ ownerUid, token, fetchFn = fetch, signal } = {}) {
  const message = 'Your uploaded videos could not be loaded. Please try again.';
  try {
    active(signal);
    credentials(ownerUid, token, fetchFn);
    const hash = await ownerDigest(ownerUid);
    const query = new URLSearchParams({
      q: `trashed = false and 'me' in owners and properties has { key='watchPartyOwnerHash' and value='${hash}' }`,
      fields: 'files(id,name,mimeType,size,ownedByMe,properties)', pageSize: '50', orderBy: 'createdTime desc',
    });
    const result = await data(await request(fetchFn, `${API}/files?${query}`, { token, signal }), signal, message);
    if (!Array.isArray(result?.files)) fail(message);
    return result.files.slice(0, 50).filter(file => canonicalId(file?.id) && file.ownedByMe === true &&
      ['video/mp4', 'video/webm'].includes(file.mimeType) && file.properties?.watchPartyVersion === '1' &&
      file.properties?.watchPartyOwnerHash === hash && Number.isSafeInteger(Number(file.size)) && Number(file.size) > 0)
      .map(file => ({ source: 'drive', id: file.id, title: titleOf(file.name), size: Number(file.size), mimeType: file.mimeType }));
  } catch (error) { throw safeError(error, signal, message); }
}

/** Upload remains private. Access tokens and resumable URLs exist only in this call. */
export async function uploadDriveVideo({ file, ownerUid, token, fetchFn = fetch, signal, onProgress = () => {} } = {}) {
  try {
    active(signal);
    credentials(ownerUid, token, fetchFn);
    if (!file || !['video/mp4', 'video/webm'].includes(file.type) || typeof file.slice !== 'function') fail('Choose an MP4 or WebM video.');
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_SIZE) fail('Choose a nonempty video up to 2 GiB.');
    if (typeof onProgress !== 'function') fail(UPLOAD_ERROR);
    const options = { token, signal };
    const { storageQuota } = await data(await request(fetchFn, `${API}/about?fields=storageQuota`, options), signal,
      'Google Drive storage quota could not be checked.');
    const integer = value => typeof value === 'string' && /^\d+$/.test(value);
    if (!storageQuota || !integer(storageQuota.usage) || (storageQuota.limit !== undefined && !integer(storageQuota.limit))) fail('Google Drive storage quota could not be checked.');
    if (storageQuota.limit !== undefined && BigInt(storageQuota.limit) - BigInt(storageQuota.usage) < BigInt(file.size)) fail('Your Google Drive has insufficient free storage for this video.');
    const title = titleOf(file.name);
    const ownerHash = await ownerDigest(ownerUid);
    active(signal);
    const started = await request(fetchFn, `${UPLOAD}?uploadType=resumable&fields=id,name,mimeType,size,properties`, {
      ...options, method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(file.size), 'X-Upload-Content-Type': file.type },
      body: JSON.stringify({ name: title, mimeType: file.type, properties: {
        watchPartyVersion: '1', watchPartyOwnerHash: ownerHash, watchPartyRoom: '',
      } }),
    });
    if (!started?.ok) fail(UPLOAD_ERROR);
    const session = sessionLocation(started.headers.get('Location'));
    let offset = 0, sent = 0, recoveries = 0, stalled = 0, requests = 0, lastProgress = -1;
    const progress = bytes => {
      active(signal);
      const percent = Math.floor(bytes * 100 / file.size);
      if (percent !== lastProgress) { onProgress(percent); lastProgress = percent; }
      active(signal);
    };
    const finish = async response => {
      if (sent !== file.size) fail(UPLOAD_ERROR);
      const metadata = await data(response, signal, UPLOAD_ERROR);
      if (!canonicalId(metadata.id) || (metadata.size !== undefined && String(metadata.size) !== String(file.size)) ||
        (metadata.mimeType !== undefined && metadata.mimeType !== file.type)) fail(UPLOAD_ERROR);
      progress(file.size);
      return { source: 'drive', id: metadata.id, title, size: file.size, mimeType: file.type };
    };
    const probe = async () => {
      while (recoveries++ < 3) {
        try {
          const response = await request(fetchFn, session, { ...options, method: 'PUT', headers: { 'Content-Range': `bytes */${file.size}` } });
          if (response.status !== 429 && response.status < 500) return response;
        } catch (error) { active(signal); if (error?.name === 'AbortError') throw error; }
      }
      fail(UPLOAD_ERROR);
    };
    progress(0);
    // Bound even a server that repeatedly reports tiny, partial acknowledgements.
    const requestLimit = Math.ceil(file.size / CHUNK) * 4 + 4;
    while (++requests <= requestLimit) {
      let response;
      if (offset === file.size) response = await probe();
      else {
        const end = Math.min(offset + CHUNK, file.size);
        const body = file.slice(offset, end);
        if (body.size !== end - offset) fail(UPLOAD_ERROR);
        sent = Math.max(sent, end);
        try {
          response = await request(fetchFn, session, { ...options, method: 'PUT',
            headers: { 'Content-Type': file.type, 'Content-Range': `bytes ${offset}-${end - 1}/${file.size}` }, body });
        } catch (error) {
          active(signal);
          if (error?.name === 'AbortError') throw error;
          response = await probe();
        }
        if (response.status === 429 || response.status >= 500) response = await probe();
      }
      if ([200, 201].includes(response.status)) return await finish(response);
      if (response.status !== 308) fail(UPLOAD_ERROR);
      const next = acknowledged(response, offset, sent, file.size);
      stalled = next === offset ? stalled + 1 : 0;
      if (stalled >= 3) fail(UPLOAD_ERROR);
      offset = next;
      if (offset < file.size) progress(offset);
    }
    fail(UPLOAD_ERROR);
  } catch (error) { throw safeError(error, signal, UPLOAD_ERROR); }
}

/** Bind one explicit room, then grant only its backend service account reader access. */
export async function shareUploadedVideo({ id, ownerUid, roomId, readerEmail, token, fetchFn = fetch, signal } = {}) {
  try {
    active(signal);
    credentials(ownerUid, token, fetchFn);
    if (!canonicalId(id) || typeof roomId !== 'string' || roomId.trim() !== roomId || !/^[A-Za-z0-9_-]{1,100}$/.test(roomId)) fail(SHARE_ERROR);
    if (typeof readerEmail !== 'string' || readerEmail.length > 254 ||
      !/^[A-Za-z0-9._+-]+@(?:[A-Za-z0-9-]+\.)+gserviceaccount\.com$/.test(readerEmail)) fail('A valid Google Drive service account is required for room sharing.');
    const options = { token, signal };
    const fields = 'id,ownedByMe,properties,permissions(id,type,role,emailAddress)';
    const metadata = await data(await request(fetchFn, `${API}/files/${id}?fields=${fields}`, options), signal, SHARE_ERROR);
    const ownerHash = await ownerDigest(ownerUid);
    active(signal);
    if (metadata.id !== id || metadata.ownedByMe !== true || metadata.properties?.watchPartyVersion !== '1' ||
      metadata.properties?.watchPartyOwnerHash !== ownerHash || !Array.isArray(metadata.permissions)) fail(SHARE_ERROR);
    const existing = metadata.permissions.find(permission => permission.type === 'user' &&
      typeof permission.emailAddress === 'string' && permission.emailAddress.toLowerCase() === readerEmail.toLowerCase());
    if (existing && existing.role !== 'reader') fail(SHARE_ERROR);
    await data(await request(fetchFn, `${API}/files/${id}?fields=id`, { ...options, method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ properties: { watchPartyRoom: roomId } }),
    }), signal, SHARE_ERROR);
    if (!existing) {
      await data(await request(fetchFn, `${API}/files/${id}/permissions?sendNotificationEmail=false&fields=id`, {
        ...options, method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: readerEmail }),
      }), signal, SHARE_ERROR);
    }
    return { source: 'drive', id };
  } catch (error) { throw safeError(error, signal, SHARE_ERROR); }
}
