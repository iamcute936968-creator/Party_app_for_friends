// Test-only OAuth substitution. Auth tokens, persistence and RTDB remain real SDK/emulator behavior.
import { onAuthStateChanged, GoogleAuthProvider, linkWithCredential, signInWithCredential, signOut, signInAnonymously } from 'firebase/auth';
import { firebaseAuth } from './firebase-emulator-client.js';
export { database, ensureFirebaseUser, firebaseAuth } from './firebase-emulator-client.js';

function googleCredential(auth) {
  const emulator = auth?.emulatorConfig;
  if (auth !== firebaseAuth || auth.app.options.projectId !== 'demo-watch-party' ||
    emulator?.host !== '127.0.0.1' || emulator.port !== 9099 || emulator.protocol !== 'http') {
    throw new Error('Fake Google credentials are restricted to the local Auth emulator.');
  }
  const subject = window.testGoogleSubject || 'emulator-movie-fan';
  if (typeof subject !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(subject)) throw new Error('Invalid local Google subject.');
  const encode = value => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: 'https://accounts.google.com', aud: 'demo-local-key', sub: subject,
    email: `${subject}@example.test`, email_verified: true, name: 'Emulator movie fan', iat: now, exp: now + 3600 };
  return GoogleAuthProvider.credential(`${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.`);
}

export const accountSdk = {
  onAuthStateChanged, GoogleAuthProvider, signOut, signInAnonymously,
  linkWithPopup: user => linkWithCredential(user, googleCredential(firebaseAuth)),
  signInWithPopup: auth => signInWithCredential(auth, googleCredential(auth)),
};
