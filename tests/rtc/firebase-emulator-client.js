// Test-only transport: real Firebase SDKs against loopback emulators.
import { initializeApp } from 'firebase/app';
import { getDatabase, connectDatabaseEmulator, onValue as observe } from 'firebase/database';
import { getAuth, connectAuthEmulator, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, linkWithPopup, signInWithPopup, signOut } from 'firebase/auth';
import { createAnonymousSession } from '../../src/auth/anonymousSession';
const app = initializeApp({ projectId: 'demo-watch-party', apiKey: 'demo-local-key', databaseURL: 'https://demo-watch-party-default-rtdb.firebaseio.com' });
export const database = getDatabase(app);
connectDatabaseEmulator(database, '127.0.0.1', 9000);
const auth = getAuth(app);
export const firebaseAuth = auth;
export const accountSdk = { onAuthStateChanged, GoogleAuthProvider, linkWithPopup, signInWithPopup, signOut, signInAnonymously };
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
export const ensureFirebaseUser = createAnonymousSession(auth, signInAnonymously);
// Test-only hostile endpoint: freeze callbacks while its established native peer runs.
export const onValue = (target, next, error) => observe(target,
  (snapshot) => { if (!window.testIgnoreAuthorizationUpdates) next(snapshot); },
  (reason) => { if (!window.testIgnoreAuthorizationUpdates) error?.(reason); });
export * from 'firebase/database';
