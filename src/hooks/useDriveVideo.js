/**
 * useDriveVideo.js
 *
 * Given a Drive file ID and a valid OAuth access token, fetches Drive file
 * metadata and the raw media as a Blob, producing an ObjectURL for HTML5
 * video playback.
 *
 * Features:
 *  - metadata fetch with capabilities.canDownload check
 *  - streaming download via ReadableStream reader with live progress
 *  - AbortController so in-flight fetches can be cancelled on cleanup /
 *    video change
 *  - ObjectURL lifecycle management (revoke on new load or unmount)
 *  - 401 callback to let the caller trigger re-authorization
 *
 * Does NOT impose a hard file-size limit — the caller receives file size in
 * `metadata` and can display a warning.
 * Does NOT reject on non-mp4 MIME types — the caller attempts HTML5 playback
 * and handles the native video error event.
 */
import { useState, useRef, useCallback, useEffect } from 'react';

const API_ROOT = 'https://www.googleapis.com/drive/v3/files/';

export function useDriveVideo(onUnauthorized) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);   // 0–100
  const [error, setError] = useState(null);

  // Keep a ref to the onUnauthorized callback so driveFetch remains referentially stable.
  const onUnauthorizedRef = useRef(onUnauthorized);
  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

  // Keep a ref to the current ObjectURL so we can revoke it on the next load.
  const currentBlobUrlRef = useRef(null);
  // AbortController for in-flight fetch.
  const abortControllerRef = useRef(null);

  const revokeCurrent = useCallback(() => {
    if (currentBlobUrlRef.current) {
      try { URL.revokeObjectURL(currentBlobUrlRef.current); } catch { /* swallow */ }
      currentBlobUrlRef.current = null;
    }
    setBlobUrl(null);
  }, []);

  /**
   * Abort any in-flight download without revoking the current ObjectURL
   * (useful when the user cancels a download before it completes).
   */
  const cancelDownload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setProgress(0);
  }, []);

  /**
   * Internal authenticated fetch helper.
   * Throws on network error or non-2xx HTTP status.
   * Calls onUnauthorized() on 401 so the caller can prompt re-auth.
   */
  const driveFetch = useCallback(async (url, accessToken, signal) => {
    let response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err; // propagate cancellation
      throw new Error(`Network error contacting Google Drive: ${err.message}`);
    }

    if (!response.ok) {
      if (response.status === 401) {
        if (!signal.aborted) onUnauthorizedRef.current?.();
        throw new Error('401: OAuth token expired or invalid. Please re-authorize.');
      }
      if (response.status === 403) {
        throw new Error(`Access denied (403). The host needs to share this Google Drive file with your Google account before you can watch it. Ask the host to share the file and then try authorizing again.`);
      }
      throw new Error(`Drive request failed with HTTP ${response.status}.`);
    }
    return response;
  }, []);

  /**
   * Fetch Drive file metadata, then download the media as a Blob.
   *
   * @param {string} fileId      Drive file ID
   * @param {string} accessToken OAuth access token
   */
  const loadDriveVideo = useCallback(async (fileId, accessToken) => {
    if (!fileId || !accessToken) return;

    // Cancel any previous in-flight download.
    cancelDownload();
    // Revoke the previous ObjectURL.
    revokeCurrent();
    setMetadata(null);
    setError(null);
    setLoading(true);
    setProgress(0);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // ----------------------------------------------------------------
      // 1. Metadata fetch
      // ----------------------------------------------------------------
      const metaUrl =
        `${API_ROOT}${encodeURIComponent(fileId)}` +
        `?fields=name,size,mimeType,capabilities(canDownload)`;
      const metaResponse = await driveFetch(metaUrl, accessToken, controller.signal);
      const meta = await metaResponse.json();
      if (abortControllerRef.current !== controller) return;

      // Warn (not block) if canDownload is explicitly false.
      if (meta.capabilities?.canDownload === false) {
        throw new Error(
          'This file cannot be downloaded (capabilities.canDownload = false). ' +
          'Check sharing and download permissions.'
        );
      }

      // Warn if MIME type is not a video/* type, but still proceed.
      // The HTML5 video element will raise an error event if the browser
      // cannot decode the container/codec.
      if (meta.mimeType && !meta.mimeType.startsWith('video/')) {
        console.warn(
          `[Drive] File MIME type is "${meta.mimeType}" — not a video/* type. ` +
          `Attempting HTML5 playback anyway; the browser will report an error if unsupported.`
        );
      }

      setMetadata(meta);

      // ----------------------------------------------------------------
      // 2. Media download with streaming progress
      // ----------------------------------------------------------------
      const mediaUrl = `${API_ROOT}${encodeURIComponent(fileId)}?alt=media`;
      const mediaResponse = await driveFetch(mediaUrl, accessToken, controller.signal);

      const contentLength = Number(mediaResponse.headers.get('content-length')) || 0;
      const reader = mediaResponse.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        // Guard: only update progress for the active request.
        if (contentLength > 0 && abortControllerRef.current === controller) {
          setProgress(Math.round((received / contentLength) * 100));
        }
      }

      if (received === 0) {
        throw new Error('Drive returned an empty media response.');
      }

      // Guard: only commit state if this request is still the active one.
      // If a newer loadDriveVideo() call has already started, its controller
      // will have replaced ours — silently discard this result.
      if (abortControllerRef.current !== controller) return;

      // Assemble the Blob from chunks.
      const blob = new Blob(chunks, { type: meta.mimeType || 'video/mp4' });
      const url = URL.createObjectURL(blob);

      // Store the URL ref so we can revoke it later.
      currentBlobUrlRef.current = url;
      setBlobUrl(url);
      setProgress(100);
    } catch (err) {
      // Guard: only update error/state for the active request.
      if (abortControllerRef.current !== controller) return;
      if (err.name === 'AbortError') {
        // User-initiated cancel — not an error.
        setError(null);
      } else {
        setError(err.message);
      }
    } finally {
      // Only clear the loading flag and controller ref if we are still active.
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setLoading(false);
      }
    }
  }, [driveFetch, cancelDownload, revokeCurrent]);

  /**
   * Explicitly revoke the current ObjectURL.
   * Call this when the Drive video source is being replaced by YouTube,
   * or when leaving the room. The HTML5Adapter.destroy() also revokes its
   * own copy, but this provides a safety net for the hook's ref.
   */
  const revokeBlobUrl = useCallback(() => {
    cancelDownload();
    revokeCurrent();
    setMetadata(null);
    setError(null);
    setProgress(0);
  }, [cancelDownload, revokeCurrent]);

  useEffect(() => () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (currentBlobUrlRef.current) {
      try { URL.revokeObjectURL(currentBlobUrlRef.current); } catch { /* Already released. */ }
      currentBlobUrlRef.current = null;
    }
  }, []);

  return {
    blobUrl,
    metadata,
    loading,
    progress,
    error,
    loadDriveVideo,
    revokeBlobUrl,
    cancelDownload,
  };
}
