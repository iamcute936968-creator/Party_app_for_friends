import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { onValue, set } from '../helpers/firebase-database';
import { useAccountProfile } from '../../src/hooks/useAccountProfile';

const db = {};
const google = { uid: 'account-a', isAnonymous: false, displayName: ' Google Alice ', photoURL: 'https://lh3.googleusercontent.com/a/alice' };
let listeners;
const snapshot = value => ({ val: () => value });
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
beforeEach(() => {
  vi.clearAllMocks(); listeners = [];
  onValue.mockImplementation((target, receive, fail) => {
    const unsubscribe = vi.fn(); listeners.push({ target, receive, fail, unsubscribe }); return unsubscribe;
  });
  set.mockResolvedValue();
});
afterEach(cleanup);

it('subscribes only to the signed-in account and uses Google fallback without automatically importing it', () => {
  const { result } = renderHook(() => useAccountProfile(db, google));
  expect(listeners[0].target.path).toBe('accounts/account-a/profile');
  expect(result.current.profile).toEqual({ displayName: 'Google Alice', photoURL: google.photoURL, sharePhoto: false });
  expect(result.current.status).toBe('loading');
  expect(set).not.toHaveBeenCalled();
  act(() => listeners[0].receive(snapshot(null)));
  expect(result.current.profile.displayName).toBe('Google Alice');
  expect(result.current.status).toBe('ready');
  expect(set).not.toHaveBeenCalled();
});

it('normalizes stored profile and writes only the private three-field allowlist on an explicit save', async () => {
  const { result } = renderHook(() => useAccountProfile(db, google));
  act(() => listeners[0].receive(snapshot({ displayName: ' Stored Alice ', photoURL: google.photoURL, sharePhoto: true, email: 'private@example.test' })));
  expect(result.current.profile).toEqual({ displayName: 'Stored Alice', photoURL: google.photoURL, sharePhoto: true });
  await act(async () => result.current.saveProfile({ displayName: ' Updated\n Alice ', photoURL: 'https://evil.test/photo', sharePhoto: true,
    email: 'private@example.test', uid: 'different-account', accessToken: 'private-token' }));
  expect(set).toHaveBeenCalledWith({ path: 'accounts/account-a/profile' }, { displayName: 'Updated Alice', photoURL: '', sharePhoto: false });
  expect(result.current.profile).toEqual({ displayName: 'Updated Alice', photoURL: '', sharePhoto: false });
  expect(result.current.error).toBe('');
});

it('never reads or writes account profiles for signed-out or anonymous sessions', async () => {
  const { result, rerender } = renderHook(({ user }) => useAccountProfile(db, user), { initialProps: { user: null } });
  expect(result.current.profile).toEqual({ displayName: '', photoURL: '', sharePhoto: false });
  await expect(result.current.saveProfile({ displayName: 'No write' })).rejects.toThrow('Sign in with Google to save your profile.');
  rerender({ user: { ...google, isAnonymous: true } });
  await expect(result.current.saveProfile({ displayName: 'No write' })).rejects.toThrow('Sign in with Google to save your profile.');
  expect(onValue).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
});

it('isolates account changes and ignores late subscription callbacks and errors', () => {
  const frames = [];
  const { result, rerender } = renderHook(({ user }) => {
    const profile = useAccountProfile(db, user); frames.push({ uid: user?.uid, name: profile.profile.displayName }); return profile;
  }, { initialProps: { user: google } });
  act(() => listeners[0].receive(snapshot({ displayName: 'Private Alice' })));
  const old = listeners[0];
  rerender({ user: { ...google, uid: 'account-b', displayName: 'Bob' } });
  expect(old.unsubscribe).toHaveBeenCalledTimes(1);
  expect(listeners[1].target.path).toBe('accounts/account-b/profile');
  expect(result.current.profile.displayName).toBe('Bob');
  act(() => { old.receive(snapshot({ displayName: 'Leaked Alice' })); old.fail(new Error('private-provider-detail')); });
  expect(result.current.profile.displayName).toBe('Bob'); expect(result.current.error).toBe('');
  expect(frames.filter(frame => frame.uid === 'account-b').every(frame => frame.name === 'Bob')).toBe(true);
  act(() => listeners[1].receive(snapshot({ displayName: 'Stored Bob' })));
  expect(result.current.profile.displayName).toBe('Stored Bob');
});

it('ignores an old account save completion and guards callbacks after unmount', async () => {
  const pending = deferred(); set.mockReturnValueOnce(pending.promise);
  const { result, rerender, unmount } = renderHook(({ user }) => useAccountProfile(db, user), { initialProps: { user: google } });
  let saving;
  act(() => { saving = result.current.saveProfile({ displayName: 'Saved Alice' }); });
  rerender({ user: { ...google, uid: 'account-b', displayName: 'Bob' } });
  await act(async () => { pending.resolve(); await saving; });
  expect(result.current.profile.displayName).toBe('Bob'); expect(result.current.status).toBe('loading');
  const current = listeners[1]; unmount();
  expect(current.unsubscribe).toHaveBeenCalledTimes(1);
  expect(() => { current.receive(snapshot({ displayName: 'Late' })); current.fail(new Error('private')); }).not.toThrow();
});

it('masks read and save failures and can retry an explicit save', async () => {
  const { result } = renderHook(() => useAccountProfile(db, google));
  act(() => listeners[0].fail(new Error('private-token-provider-detail')));
  expect(result.current.error).toBe('Could not load your profile. Try again.');
  set.mockRejectedValueOnce(new Error('private-token-provider-detail'));
  await act(async () => {
    await expect(result.current.saveProfile({ displayName: 'Alice' })).rejects.toThrow('Could not save your profile. Try again.');
  });
  expect(result.current.error).toBe('Could not save your profile. Try again.');
  expect(result.current.status).toBe('error');
  await act(async () => result.current.saveProfile({ displayName: 'Alice' }));
  expect(result.current.error).toBe(''); expect(result.current.profile.displayName).toBe('Alice');
});

it('ignores old save rejection after account replacement and tears down on anonymous transition', async () => {
  const pending = deferred(); set.mockReturnValueOnce(pending.promise);
  const { result, rerender } = renderHook(({ user }) => useAccountProfile(db, user), { initialProps: { user: google } });
  let saving;
  act(() => { saving = result.current.saveProfile({ displayName: 'Alice' }); });
  rerender({ user: { ...google, uid: 'account-b', displayName: 'Bob' } });
  await act(async () => {
    pending.reject(new Error('private-provider-token'));
    await expect(saving).rejects.toThrow('Could not save your profile. Try again.');
  });
  expect(result.current.error).toBe(''); expect(result.current.profile.displayName).toBe('Bob');
  const old = listeners[1];
  rerender({ user: { ...google, uid: 'account-b', isAnonymous: true } });
  act(() => old.receive(snapshot({ displayName: 'Must stay private' })));
  expect(old.unsubscribe).toHaveBeenCalledTimes(1);
  expect(result.current.profile).toEqual({ displayName: '', photoURL: '', sharePhoto: false });
  expect(result.current.status).toBe('idle');
});

it('resubscribes when the database changes and masks synchronous subscription failures', () => {
  const { result, rerender } = renderHook(({ database }) => useAccountProfile(database, google), { initialProps: { database: db } });
  const old = listeners[0];
  onValue.mockImplementationOnce(() => { throw new Error('private-provider-token'); });
  rerender({ database: {} });
  expect(old.unsubscribe).toHaveBeenCalledTimes(1);
  expect(result.current.error).toBe('Could not load your profile. Try again.');
  expect(result.current.profile.displayName).toBe('Google Alice');
});
