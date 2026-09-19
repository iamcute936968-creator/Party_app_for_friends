/**
 * useDriveStream.js — Phase 7.2 Google Drive HTTP Range Streaming Hook
 *
 * Requests short-lived playback tickets from media-proxy and provides
 * an opaque HTTP media URL for HTML5 <video> streaming with native Range requests.
 *
 * Features:
 *  - Requests ticket via POST /api/ticket with S1 roomSecret authorization
 *  - Resolves opaque mediaUrl pointing to media-proxy /media/:fileId?t=...
 *  - Generation-guarded and AbortController-protected against race conditions and unmounts
 *  - Does NOT fetch media bytes in the browser — leaves Range requests to HTML5 <video>
 *  - Clean error handling with friendly messaging without leaking tickets or secrets
 */
import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Normalizes a base URL by removing any trailing slashes.
 */
function normalizeBaseUrl(url) {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '');
}

export function useDriveStream(options = {}) {
  // Keep a ref to options so loadDriveStream remains referentially stable.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const [mediaUrl, setMediaUrl] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const abortControllerRef = useRef(null);
  const currentMediaUrlRef = useRef(null);
  const requestGenRef = useRef(0);

  /**
   * Cancels any in-flight ticket request without clearing existing mediaUrl.
   */
  const cancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
  }, []);

  /**
   * Fully revokes current media stream state and cancels in-flight requests.
   */
  const revoke = useCallback(() => {
    cancelStream();
    currentMediaUrlRef.current = null;
    setMediaUrl(null);
    setMetadata(null);
    setError(null);
    setLoading(false);
  }, [cancelStream]);

  /**
   * Requests a short-lived playback ticket from media-proxy and sets the opaque media URL.
   *
   * @param {string} fileId
   * @param {Object} params
   * @param {string} params.roomId
   * @param {string} params.roomSecret
   * @param {string} params.username
   * @param {string} [params.proxyUrl]
   */
  const loadDriveStream = useCallback(async (fileId, { roomId, roomSecret, username, proxyUrl } = {}) => {
    // 1. Cancel previous in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const currentGen = ++requestGenRef.current;

    // Reset error, set loading
    setError(null);
    setLoading(true);

    const activeOptions = optionsRef.current;
    const effectiveProxy = proxyUrl || activeOptions.proxyUrl || import.meta.env.VITE_MEDIA_PROXY_URL || '';
    const baseProxyUrl = normalizeBaseUrl(effectiveProxy);

    try {
      if (!baseProxyUrl) {
        throw new Error('Media proxy URL is not configured. Please set VITE_MEDIA_PROXY_URL.');
      }
      if (!fileId || typeof fileId !== 'string') {
        throw new Error('Invalid or missing fileId.');
      }
      if (!roomId || !roomSecret || !username) {
        throw new Error('Missing room authorization parameters (roomId, roomSecret, or username).');
      }

      const ticketEndpoint = `${baseProxyUrl}/api/ticket`;
      const response = await fetch(ticketEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          roomId,
          roomSecret,
          username,
          fileId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errMessage = `HTTP ${response.status} from media proxy`;
        try {
          const errData = await response.json();
          if (errData && (errData.message || errData.error)) {
            errMessage = errData.message || errData.error;
          }
        } catch {
          // Ignore non-JSON error response bodies
        }

        if (response.status === 401 || response.status === 403) {
          optionsRef.current.onUnauthorized?.();
        }
        throw new Error(errMessage);
      }

      const data = await response.json();
      if (!data || !data.mediaUrl) {
        throw new Error('Invalid ticket response: missing mediaUrl');
      }

      // Check for stale response / cancellation
      if (requestGenRef.current !== currentGen || abortControllerRef.current !== controller) {
        return;
      }

      // Resolve full opaque media URL
      let fullMediaUrl;
      if (data.mediaUrl.startsWith('http://') || data.mediaUrl.startsWith('https://')) {
        fullMediaUrl = data.mediaUrl;
      } else {
        fullMediaUrl = new URL(data.mediaUrl, `${baseProxyUrl}/`).toString();
      }

      currentMediaUrlRef.current = fullMediaUrl;
      setMediaUrl(fullMediaUrl);
      setMetadata({ fileId, expiresAt: data.expiresAt });
      setError(null);
    } catch (err) {
      if (requestGenRef.current !== currentGen || abortControllerRef.current !== controller) {
        return;
      }
      if (err.name === 'AbortError') {
        // User/system cancelled — not a displayed error
        setError(null);
      } else {
        setError(err.message || 'Failed to prepare video stream');
      }
    } finally {
      if (requestGenRef.current === currentGen && abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  return {
    mediaUrl,
    metadata,
    loading,
    error,
    loadDriveStream,
    revoke,
    revokeStream: revoke,
    cancelStream,
  };
}
