import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AccountPanel from '../../src/components/AccountPanel';

afterEach(cleanup);
const photoURL = 'https://lh3.googleusercontent.com/account-photo';
const account = (extra = {}) => ({ user: null, pending: false, connectGoogle: vi.fn(), disconnect: vi.fn(), useExistingGoogleAccount: vi.fn(), ...extra });
const signedIn = (extra = {}) => account({ user: { uid: 'owner', isAnonymous: false, displayName: 'Google name', email: 'private@example.test' }, ...extra });

it('renders nothing without an account and offers Google linking for guests', async () => {
  const view = render(<AccountPanel />);
  expect(view.container.textContent).toBe('');
  const guest = account({ user: { uid: 'guest', isAnonymous: true } });
  view.rerender(<AccountPanel account={guest} />);
  expect(screen.getByText(/guest/i)).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' })));
  expect(guest.connectGoogle).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
});

it('disables pending account actions and makes a collision switch explicit', async () => {
  const current = account({ pending: true, collision: true, error: 'This Google account already exists.' });
  const view = render(<AccountPanel account={current} />);
  expect(screen.getByRole('button', { name: 'Continue with Google' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Use existing Google account' }).disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toBe(current.error);
  expect(current.useExistingGoogleAccount).not.toHaveBeenCalled();
  view.rerender(<AccountPanel account={{ ...current, pending: false }} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use existing Google account' })));
  expect(current.useExistingGoogleAccount).toHaveBeenCalledOnce();
});

it('shows signed-in names as plain text, never displays email, and signs out', async () => {
  const current = signedIn({ user: { uid: 'owner', displayName: '<img src=x onerror=alert(1)>', email: 'private@example.test', isAnonymous: false } });
  const view = render(<AccountPanel account={current} />);
  expect(screen.getByText(current.user.displayName)).toBeTruthy();
  expect(view.container.querySelector('img')).toBeNull();
  expect(view.container.textContent).not.toContain(current.user.email);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out' })));
  expect(current.disconnect).toHaveBeenCalledOnce();
});

it('saves normalized display name and explicitly opted-in safe Google photo', async () => {
  const saveProfile = vi.fn().mockResolvedValue();
  const view = render(<AccountPanel account={signedIn()} profile={{ photoURL }} saveProfile={saveProfile} />);
  const name = screen.getByLabelText('Display name');
  expect(name.value).toBe('Google name');
  expect(name.maxLength).toBe(40);
  const share = screen.getByRole('checkbox', { name: 'Share Google photo with room' });
  expect(share.checked).toBe(false);
  expect(view.container.querySelector('img')).toBeNull();
  fireEvent.change(name, { target: { value: '  Room friend  ' } });
  fireEvent.click(share);
  expect(view.container.querySelector('img').getAttribute('src')).toBe(photoURL);
  fireEvent.error(view.container.querySelector('img'));
  expect(view.container.querySelector('img')).toBeNull();
  await act(async () => fireEvent.submit(screen.getByRole('button', { name: 'Save profile' }).closest('form')));
  expect(saveProfile).toHaveBeenCalledWith({ displayName: 'Room friend', photoURL, sharePhoto: true });
});

it('rejects unsafe photo URLs and hides profile controls for guests or missing save handler', () => {
  const view = render(<AccountPanel account={signedIn()} profile={{ photoURL: 'javascript:alert(1)', sharePhoto: true }} saveProfile={vi.fn()} />);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(view.container.querySelector('img')).toBeNull();
  view.rerender(<AccountPanel account={account()} profile={{ photoURL }} saveProfile={vi.fn()} />);
  expect(screen.queryByLabelText('Display name')).toBeNull();
  view.rerender(<AccountPanel account={signedIn()} profile={{ photoURL }} />);
  expect(screen.queryByLabelText('Display name')).toBeNull();
});

it('resets draft name and photo consent when account UID or profile changes', () => {
  const current = signedIn(), saveProfile = vi.fn();
  const view = render(<AccountPanel account={current} profile={{ displayName: 'Saved name', photoURL }} saveProfile={saveProfile} />);
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Unsaved draft' } });
  fireEvent.click(screen.getByRole('checkbox'));
  view.rerender(<AccountPanel account={signedIn({ user: { uid: 'another', displayName: 'Other user', isAnonymous: false } })} profile={{ displayName: 'Other profile', photoURL }} saveProfile={saveProfile} />);
  expect(screen.getByLabelText('Display name').value).toBe('Other profile');
  expect(screen.getByRole('checkbox').checked).toBe(false);
  view.rerender(<AccountPanel account={signedIn({ user: { uid: 'another', displayName: 'Other user', isAnonymous: false } })} profile={{ displayName: 'Remote updated', photoURL, sharePhoto: true }} saveProfile={saveProfile} />);
  expect(screen.getByLabelText('Display name').value).toBe('Remote updated');
  expect(screen.getByRole('checkbox').checked).toBe(true);
});

it('imports guest items only after an explicit click and displays cloud state', async () => {
  const library = { guestItemCount: 2, importGuest: vi.fn().mockResolvedValue(), cloudStatus: 'syncing' };
  const view = render(<AccountPanel account={signedIn()} library={library} />);
  expect(library.importGuest).not.toHaveBeenCalled();
  expect(screen.getByText(/Syncing your cloud library/)).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Import guest library' })));
  expect(library.importGuest).toHaveBeenCalledOnce();
  view.rerender(<AccountPanel account={signedIn()} library={{ ...library, cloudStatus: 'synced' }} />);
  expect(screen.getByText(/Cloud library is up to date/)).toBeTruthy();
  view.rerender(<AccountPanel account={account()} library={library} />);
  expect(screen.queryByRole('button', { name: 'Import guest library' })).toBeNull();
});

it('masks rejected account, import and profile errors', async () => {
  const failure = new Error('private provider token detail');
  const current = signedIn({ disconnect: vi.fn().mockRejectedValue(failure) });
  const view = render(<AccountPanel account={current} library={{ guestItemCount: 1, importGuest: vi.fn().mockRejectedValue(failure), cloudStatus: 'error', cloudError: failure.message }} profile={{}} saveProfile={vi.fn().mockRejectedValue(failure)} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out' })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Import guest library' })));
  await act(async () => fireEvent.submit(screen.getByRole('button', { name: 'Save profile' }).closest('form')));
  expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  expect(view.container.textContent).not.toMatch(/private|provider token detail/);
});
