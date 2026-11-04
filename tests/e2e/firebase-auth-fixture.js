// Served only by Playwright. Never authenticates against a real provider.
const makeUser = (uid, isAnonymous, profile = {}) => ({ uid, isAnonymous, getIdToken: async () => 'fixture-id-token', ...profile });
const auth = { currentUser: makeUser('fixture-user', true), authStateReady: async () => {} };
const observers = new Set();
let guestCount = 0, holdPopup = false, releasePopup, collision = false;
const notify = user => {
  auth.currentUser = user;
  for (const next of observers) queueMicrotask(() => { if (observers.has(next)) next(user); });
  return user;
};
const popup = async () => { if (holdPopup) await new Promise(resolve => { releasePopup = resolve; }); };
const googleProfile = { displayName: 'Movie fan', photoURL: 'https://lh3.googleusercontent.com/fixture-photo', email: 'private-google@example.test' };

window.holdGooglePopup = () => { holdPopup = true; };
window.releaseGooglePopup = () => { holdPopup = false; releasePopup?.(); releasePopup = null; };
window.setGooglePopupCollision = (value = true) => { collision = value; };
export const getAuth = () => auth;
export const signInAnonymously = async () => ({ user: notify(makeUser(`fixture-guest-${++guestCount}`, true)) });
export const onAuthStateChanged = (_auth, next) => {
  observers.add(next);
  queueMicrotask(() => { if (observers.has(next)) next(auth.currentUser); });
  return () => observers.delete(next);
};
export class GoogleAuthProvider { setCustomParameters() {} }
export const linkWithPopup = async user => {
  await popup();
  if (collision) throw Object.assign(new Error('private Google credential detail'), { code: 'auth/credential-already-in-use' });
  return { user: notify(makeUser(user.uid, false, googleProfile)) };
};
export const signInWithPopup = async () => {
  await popup();
  return { user: notify(makeUser('fixture-existing-user', false, { ...googleProfile, displayName: 'Returning movie fan' })) };
};
export const signOut = async () => { notify(null); };
