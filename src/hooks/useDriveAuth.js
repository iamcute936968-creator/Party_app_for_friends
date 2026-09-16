/**
 * useDriveAuth.js
 *
 * Manages Google OAuth token lifecycle for Drive API access.
 *
 * - Loads the Google Identity Services (GIS) script on first use.
 * - Reads the OAuth client ID from import.meta.env.VITE_GOOGLE_CLIENT_ID.
 * - Stores the access token in component memory ONLY (never in localStorage
 *   or any persistent store).
 * - The client secret is NEVER used or stored.
 * - Exposes: { accessToken, isAuthorized, authorize, clearToken }
 */
import { useState, useEffect, useRef } from 'react';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const GIS_SCRIPT_ID = '__gis_client_script__';

function loadGISScript() {
  return new Promise((resolve, reject) => {
    // Already loaded.
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    // Script tag already injected (but may still be loading).
    if (document.getElementById(GIS_SCRIPT_ID)) {
      // Poll until google.accounts.oauth2 is available.
      const t = setInterval(() => {
        if (window.google?.accounts?.oauth2) { clearInterval(t); resolve(); }
      }, 100);
      return;
    }
    const script = document.createElement('script');
    script.id = GIS_SCRIPT_ID;
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      // GIS script initializes synchronously after onload.
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Google Identity Services script.'));
    document.head.appendChild(script);
  });
}

export function useDriveAuth() {
  const [accessToken, setAccessToken] = useState(null);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [gisReady, setGisReady] = useState(false);
  const tokenClientRef = useRef(null);

  // Load the GIS script once on mount.
  useEffect(() => {
    let cancelled = false;
    loadGISScript()
      .then(() => { if (!cancelled) setGisReady(true); })
      .catch((err) => { if (!cancelled) setAuthError(err.message); });
    return () => { cancelled = true; };
  }, []);

  /**
   * Open the Google OAuth consent flow.
   * Resolves with the access token string on success.
   * Rejects with an error message on failure.
   *
   * Must be called from a user-gesture handler (button click) so that the
   * popup is not blocked by the browser.
   */
  const authorize = () => {
    return new Promise((resolve, reject) => {
      if (!gisReady) {
        const msg = 'Google Identity Services is not yet loaded.';
        setAuthError(msg);
        reject(new Error(msg));
        return;
      }

      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      if (!clientId) {
        const msg = 'VITE_GOOGLE_CLIENT_ID is not configured. Add it to your .env file.';
        setAuthError(msg);
        reject(new Error(msg));
        return;
      }

      setAuthError(null);

      // Initialise (or re-use) the token client.
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (response) => {
          if (response.error) {
            const msg = response.error_description || response.error;
            setAuthError(msg);
            setIsAuthorized(false);
            setAccessToken(null);
            reject(new Error(msg));
            return;
          }
          setAccessToken(response.access_token);
          setIsAuthorized(true);
          setAuthError(null);
          resolve(response.access_token);
        },
        error_callback: (error) => {
          const msg = error?.message || 'OAuth error';
          setAuthError(msg);
          reject(new Error(msg));
        },
      });

      tokenClientRef.current.requestAccessToken({ prompt: 'consent' });
    });
  };

  /**
   * Clear the in-memory token (e.g. on 401 response from Drive API).
   */
  const clearToken = () => {
    setAccessToken(null);
    setIsAuthorized(false);
  };

  return { accessToken, isAuthorized, authError, gisReady, authorize, clearToken };
}
