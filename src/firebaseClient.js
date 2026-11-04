import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, linkWithPopup, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { createAnonymousSession } from './auth/anonymousSession';

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: 'watch-party-app-9fc62.firebaseapp.com',
  projectId: 'watch-party-app-9fc62',
  databaseURL: 'https://watch-party-app-9fc62-default-rtdb.asia-southeast1.firebasedatabase.app',
});
export const database = getDatabase(app);
export const firebaseAuth = getAuth(app);
export const accountSdk = { onAuthStateChanged, GoogleAuthProvider, linkWithPopup, signInWithPopup, signOut, signInAnonymously };
export const ensureFirebaseUser = createAnonymousSession(firebaseAuth, signInAnonymously);
