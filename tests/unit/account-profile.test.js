import { expect, it } from 'vitest';
import { normalizeAccountProfile, profileFromGoogle } from '../../src/auth/accountProfile';

const photoURL = 'https://lh3.googleusercontent.com/a/profile-image=s96-c';

it('retains only plain profile fields and bounds a trimmed, control-free display name', () => {
  expect(normalizeAccountProfile({ displayName: ' \u0000Alice\n Example\u007f\u0085 ', photoURL, sharePhoto: true,
    email: 'private@example.test', uid: 'identity-must-not-change', roomSecret: 'private', accessToken: 'private' }))
    .toEqual({ displayName: 'Alice Example', photoURL, sharePhoto: true });
  expect(normalizeAccountProfile({ displayName: 'x'.repeat(100) }).displayName).toBe('x'.repeat(40));
  expect(normalizeAccountProfile({ displayName: '<b>Alice</b>' }).displayName).toBe('<b>Alice</b>');
  expect(normalizeAccountProfile({ displayName: { toString: () => 'converted' } }).displayName).toBe('');
});

it.each([undefined, null, false, 'Alice', [], 12])('returns an empty private profile for invalid input %s', value => {
  expect(normalizeAccountProfile(value)).toEqual({ displayName: '', photoURL: '', sharePhoto: false });
});

it.each([3, 4, 5, 6])('allows only HTTPS Google photo host lh%s with a real path', host => {
  const url = `https://lh${host}.googleusercontent.com/a/avatar`;
  expect(normalizeAccountProfile({ photoURL: url, sharePhoto: true })).toEqual({ displayName: '', photoURL: url, sharePhoto: true });
});

it.each(['http://lh3.googleusercontent.com/a/avatar', 'https://lh7.googleusercontent.com/a/avatar',
  'https://lh3.googleusercontent.com.evil.test/a/avatar', 'https://evil.test/lh3.googleusercontent.com/avatar',
  'https://user:password@lh3.googleusercontent.com/a/avatar', 'https://@lh3.googleusercontent.com/a/avatar',
  'https://lh3.googleusercontent.com:443/a/avatar', 'https://lh3.googleusercontent.com:8443/a/avatar',
  'https://lh3.googleusercontent.com', 'https://lh3.googleusercontent.com/',
  'https://lh3.googleusercontent.com/?image=avatar', 'https://lh3.googleusercontent.com\n/a/avatar',
  ' https://lh3.googleusercontent.com/a/avatar', 'data:image/svg+xml,private',
  'https://lh3.googleusercontent.com/' + 'a'.repeat(2048), {}, null])('rejects unsafe or unbounded photo URL %s', url => {
  expect(normalizeAccountProfile({ photoURL: url, sharePhoto: true })).toEqual({ displayName: '', photoURL: '', sharePhoto: false });
});

it('requires explicit boolean photo consent and a valid photo', () => {
  for (const sharePhoto of [undefined, false, 'true', 1]) {
    expect(normalizeAccountProfile({ photoURL, sharePhoto })).toEqual({ displayName: '', photoURL, sharePhoto: false });
  }
  expect(normalizeAccountProfile({ sharePhoto: true }).sharePhoto).toBe(false);
});

it('imports Google profile without persisting email, identity or provider secrets, leaving photo sharing off', () => {
  expect(profileFromGoogle({ displayName: ' Alice ', photoURL, email: 'private@example.test', uid: 'uid',
    providerData: [{ email: 'private@example.test' }], refreshToken: 'secret', sharePhoto: true }))
    .toEqual({ displayName: 'Alice', photoURL, sharePhoto: false });
  expect(profileFromGoogle(null)).toEqual({ displayName: '', photoURL: '', sharePhoto: false });
});
