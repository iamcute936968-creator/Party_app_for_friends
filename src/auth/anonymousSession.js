// Share a pending sign-in across duplicate clicks; keep Firebase's persisted UID.
export function createAnonymousSession(auth, signIn) {
  let pending;
  return async () => {
    await auth.authStateReady();
    if (auth.currentUser) return auth.currentUser;
    if (!pending) pending = signIn(auth).then((result) => result.user).finally(() => { pending = null; });
    return pending;
  };
}
