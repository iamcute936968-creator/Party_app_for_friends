import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAccount } from '../../src/hooks/useAccount';
import { useRoomEntry } from '../../src/hooks/useRoomEntry';

afterEach(cleanup);
function fixture() {
  let observe;
  const auth = { currentUser: { uid: 'guest', isAnonymous: true }, authStateReady: async () => {} };
  const google = { uid: 'guest', isAnonymous: false, displayName: 'Movie fan', photoURL: 'https://lh3.googleusercontent.com/photo' };
  const sdk = { GoogleAuthProvider: class { setCustomParameters() {} },
    onAuthStateChanged: vi.fn((_auth, next) => { observe = next; next(auth.currentUser); return vi.fn(); }),
    linkWithPopup: vi.fn(async () => ({ user: google })), signInWithPopup: vi.fn(async () => ({ user: google })),
    signOut: vi.fn(async () => {}), signInAnonymously: vi.fn(async () => ({ user: auth.currentUser })),
  };
  return { auth, sdk, google, observe: value => observe(value) };
}
it('subscribes to persisted identity and keeps a synchronous transition lock until linking finishes', async () => {
  const f = fixture(); let finish;
  f.sdk.linkWithPopup.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useAccount(f.auth, f.sdk, false, false));
  expect(result.current.user.uid).toBe('guest');
  let pending;
  act(() => { pending = result.current.connectGoogle(); });
  expect(result.current.isTransitioning()).toBe(true);
  expect(result.current.pending).toBe(true);
  await act(async () => { await Promise.resolve(); finish({ user: f.google }); await pending; f.observe(f.google); });
  expect(result.current.user).toEqual(f.google);
  expect(result.current.isTransitioning()).toBe(false);
});
it('blocks account changes during entry or a room and only switches a collision explicitly', async () => {
  const f = fixture();
  const { result, rerender } = renderHook(({ room, entry }) => useAccount(f.auth, f.sdk, room, entry), { initialProps: { room: false, entry: true } });
  await act(async () => result.current.connectGoogle());
  expect(f.sdk.linkWithPopup).not.toHaveBeenCalled();
  await act(async () => rerender({ room: true, entry: false }));
  await act(async () => result.current.disconnect());
  expect(f.sdk.signOut).not.toHaveBeenCalled();
  await act(async () => rerender({ room: false, entry: false }));
  f.sdk.linkWithPopup.mockRejectedValue({ code: 'auth/credential-already-in-use', secret: 'private' });
  await act(async () => result.current.connectGoogle());
  expect(result.current.collision).toBe(true);
  expect(result.current.error).not.toContain('private');
  expect(f.sdk.signInWithPopup).not.toHaveBeenCalled();
  await act(async () => result.current.useExistingGoogleAccount());
  expect(f.sdk.signInWithPopup).toHaveBeenCalledOnce();
});
it('blocks a same-event account switch immediately after room entry starts', async () => {
  const f = fixture(); let finish;
  const { result } = renderHook(() => {
    const entry = useRoomEntry();
    return { entry, account: useAccount(f.auth, f.sdk, false, Boolean(entry.action), entry.isPending) };
  });
  let entering;
  await act(async () => {
    entering = result.current.entry.run('create', () => new Promise(resolve => { finish = resolve; }));
    await result.current.account.connectGoogle();
  });
  expect(f.sdk.linkWithPopup).not.toHaveBeenCalled();
  await act(async () => { finish(); await entering; });
  await act(async () => result.current.account.connectGoogle());
  expect(f.sdk.linkWithPopup).toHaveBeenCalledOnce();
});
