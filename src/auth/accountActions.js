const accountError = (code, message) => Object.assign(new Error(message), { code });
const unavailable = () => accountError('account-unavailable', 'Could not update your account. Please try again.');

export function createAccountActions(auth, sdk, isRoomActive = () => false) {
  let pending;
  const roomError = () => accountError('account-room-active', 'Leave the room before changing your account.');
  const provider = () => {
    const value = new sdk.GoogleAuthProvider();
    value.setCustomParameters?.({ prompt: 'select_account' });
    return value;
  };
  const transition = (action) => {
    if (isRoomActive()) return Promise.reject(roomError());
    if (pending) return pending;
    pending = (async () => {
      try { await auth.authStateReady?.(); } catch { throw unavailable(); }
      if (isRoomActive()) throw roomError();
      try {
        const result = await action();
        if (!result?.user) throw unavailable();
        return result.user;
      } catch (error) {
        if (['auth/credential-already-in-use', 'auth/email-already-in-use'].includes(error?.code)) {
          throw accountError('account-collision', 'This Google account already exists. Leave the room and explicitly use your existing Google account.');
        }
        throw unavailable();
      }
    })().finally(() => { pending = null; });
    return pending;
  };
  return {
    connectGoogle: () => transition(() => auth.currentUser?.isAnonymous
      ? sdk.linkWithPopup(auth.currentUser, provider()) : sdk.signInWithPopup(auth, provider())),
    useExistingGoogleAccount: () => transition(() => sdk.signInWithPopup(auth, provider())),
    disconnect: () => transition(async () => {
      await sdk.signOut(auth);
      return sdk.signInAnonymously(auth);
    }),
  };
}
