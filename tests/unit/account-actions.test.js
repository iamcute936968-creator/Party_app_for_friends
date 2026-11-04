import { expect, it, vi } from 'vitest';
import { createAccountActions } from '../../src/auth/accountActions';

function setup(currentUser = { uid: 'guest', isAnonymous: true }, isRoomActive = () => false) {
  const auth = { currentUser, authStateReady: vi.fn().mockResolvedValue() };
  const provider = { setCustomParameters: vi.fn() };
  const sdk = {
    GoogleAuthProvider: vi.fn(function () { return provider; }),
    linkWithPopup: vi.fn().mockResolvedValue({ user: { uid: 'guest', isAnonymous: false } }),
    signInWithPopup: vi.fn().mockResolvedValue({ user: { uid: 'existing-account' } }),
    signOut: vi.fn().mockResolvedValue(),
    signInAnonymously: vi.fn().mockResolvedValue({ user: { uid: 'new-guest', isAnonymous: true } }),
  };
  return { auth, sdk, provider, actions: createAccountActions(auth, sdk, isRoomActive) };
}

it('links an anonymous user to Google while retaining its UID and selecting an account', async () => {
  const { actions, auth, sdk, provider } = setup();
  await expect(actions.connectGoogle()).resolves.toMatchObject({ uid: 'guest' });
  expect(sdk.linkWithPopup).toHaveBeenCalledWith(auth.currentUser, provider);
  expect(provider.setCustomParameters).toHaveBeenCalledWith({ prompt: 'select_account' });
  expect(sdk.signInWithPopup).not.toHaveBeenCalled();
});

it.each([null, { uid: 'registered', isAnonymous: false }])('signs in directly when no anonymous user needs linking', async (currentUser) => {
  const { actions, auth, sdk, provider } = setup(currentUser);
  await expect(actions.connectGoogle()).resolves.toMatchObject({ uid: 'existing-account' });
  expect(sdk.signInWithPopup).toHaveBeenCalledWith(auth, provider);
  expect(sdk.linkWithPopup).not.toHaveBeenCalled();
});

it.each(['auth/credential-already-in-use', 'auth/email-already-in-use'])('explains an explicit existing-account switch after %s without silently switching', async (code) => {
  const { actions, sdk } = setup();
  sdk.linkWithPopup.mockRejectedValueOnce({ code, message: 'private credential', credential: 'private token' });
  const error = await actions.connectGoogle().catch(value => value);
  expect(error).toMatchObject({ code: 'account-collision' });
  expect(error.message).toMatch(/leave.*room.*existing Google account/i);
  expect(JSON.stringify(error)).not.toMatch(/private/);
  expect(sdk.signInWithPopup).not.toHaveBeenCalled();
  await expect(actions.useExistingGoogleAccount()).resolves.toMatchObject({ uid: 'existing-account' });
  expect(sdk.signInWithPopup).toHaveBeenCalledOnce();
});

it.each(['connectGoogle', 'useExistingGoogleAccount', 'disconnect'])('rejects %s in an active room before any SDK or auth operation', async (method) => {
  const { actions, auth, sdk } = setup(undefined, () => true);
  await expect(actions[method]()).rejects.toMatchObject({ code: 'account-room-active' });
  expect(auth.authStateReady).not.toHaveBeenCalled();
  Object.values(sdk).forEach(fn => expect(fn).not.toHaveBeenCalled());
});

it('rechecks room activity after persisted auth becomes ready', async () => {
  let active = false;
  const { actions, auth, sdk } = setup(undefined, () => active);
  auth.authStateReady.mockImplementation(async () => { active = true; });
  await expect(actions.connectGoogle()).rejects.toMatchObject({ code: 'account-room-active' });
  expect(sdk.linkWithPopup).not.toHaveBeenCalled();
});

it('deduplicates concurrent transitions, then permits a later explicit transition', async () => {
  const { actions, sdk } = setup();
  let finish;
  sdk.linkWithPopup.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const first = actions.connectGoogle();
  const duplicate = actions.connectGoogle();
  const conflicting = actions.disconnect();
  expect(duplicate).toBe(first);
  expect(conflicting).toBe(first);
  await vi.waitFor(() => expect(sdk.linkWithPopup).toHaveBeenCalledOnce());
  expect(sdk.signOut).not.toHaveBeenCalled();
  finish({ user: { uid: 'guest' } });
  await first;
  await expect(actions.disconnect()).resolves.toMatchObject({ uid: 'new-guest' });
});

it('signs out before renewing anonymous guest authentication', async () => {
  const { actions, auth, sdk } = setup({ uid: 'registered' });
  await expect(actions.disconnect()).resolves.toMatchObject({ uid: 'new-guest', isAnonymous: true });
  expect(sdk.signOut).toHaveBeenCalledWith(auth);
  expect(sdk.signInAnonymously).toHaveBeenCalledWith(auth);
  expect(sdk.signOut.mock.invocationCallOrder[0]).toBeLessThan(sdk.signInAnonymously.mock.invocationCallOrder[0]);
});

it.each(['connectGoogle', 'useExistingGoogleAccount', 'disconnect'])('masks raw provider errors from %s', async (method) => {
  const { actions, sdk } = setup();
  const privateError = Object.assign(new Error('private token secret'), { code: 'auth/private-detail', credential: 'secret' });
  sdk.linkWithPopup.mockRejectedValue(privateError);
  sdk.signInWithPopup.mockRejectedValue(privateError);
  sdk.signOut.mockRejectedValue(privateError);
  const error = await actions[method]().catch(value => value);
  expect(error).toMatchObject({ code: 'account-unavailable' });
  expect(error.message).not.toMatch(/private|token|secret/);
  expect(error.cause).toBeUndefined();
  expect(sdk.signInAnonymously).not.toHaveBeenCalled();
});

it('rejects a missing provider user and clears pending state for retry', async () => {
  const { actions, sdk } = setup();
  sdk.linkWithPopup.mockResolvedValueOnce({});
  await expect(actions.connectGoogle()).rejects.toMatchObject({ code: 'account-unavailable' });
  await expect(actions.connectGoogle()).resolves.toMatchObject({ uid: 'guest' });
});
