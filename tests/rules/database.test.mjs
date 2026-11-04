import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { getDatabase, connectDatabaseEmulator, goOffline, ref, set, get, update, runTransaction, remove, onDisconnect, onValue, serverTimestamp } from 'firebase/database';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { createAnonymousSession } from '../../src/auth/anonymousSession.js';

const messagePath = key => `rooms/ROOM_A/messages/${key}`;
const textMessage = (extra = {}) => ({ type: 'user', uid: 'guest-uid', user: 'Guest', text: 'Hello', time: '10:00', timestamp: Date.now(), ...extra });
const voiceId = '-0123456789ABCDEFGHI';
const voiceNote = (extra = {}) => ({ uid: 'guest-uid', messageId: voiceId, data: 'AQID', mimeType: 'audio/webm', bytes: 3, durationMs: 1000, createdAt: serverTimestamp(), ...extra });
const voiceMessage = (extra = {}) => textMessage({ text: 'Voice message', createdAt: serverTimestamp(), audio: { slot: '0', mimeType: 'audio/webm', bytes: 3, durationMs: 1000 }, ...extra });
const voicePatch = (note = voiceNote(), message = voiceMessage()) => ({ [messagePath(voiceId)]: message, 'roomVoiceNotes/ROOM_A/0': note });
const seed = patch => env.withSecurityRulesDisabled(context => update(ref(context.database()), patch));

test('chat edits allow only own recent trusted text and preserve every immutable field', async () => {
  const member = db('guest-uid'), target = messagePath('trusted');
  await assertSucceeds(set(ref(member, target), textMessage({ createdAt: serverTimestamp() })));
  await assertSucceeds(update(ref(member, target), { text: 'Edited', editedAt: serverTimestamp() }));
  const original = (await get(ref(member, target))).val();
  assert.equal(original.text, 'Edited'); assert.equal(typeof original.editedAt, 'number');
  for (const change of [{ uid: 'host-uid' }, { user: 'Host' }, { type: 'system' }, { time: 'other' }, { timestamp: original.timestamp + 1 },
    { createdAt: original.createdAt + 1 }, { editedAt: original.editedAt - 10 }, { extra: true }, { audio: { slot: '0' } }]) {
    await assertFails(update(ref(member, target), { text: 'Tampered', editedAt: serverTimestamp(), ...change }));
  }
  await assertFails(update(ref(db('host-uid'), target), { text: 'Foreign edit', editedAt: serverTimestamp() }));
  await assertFails(remove(ref(member, target)));
  await assertFails(update(ref(member), { [target + '/text']: 'Ancestor tamper', [target + '/uid']: 'host-uid', [target + '/editedAt']: serverTimestamp() }));
});

test('legacy, old, future, system and voice messages cannot obtain an editable window', async () => {
  const member = db('guest-uid');
  await assertSucceeds(set(ref(member, messagePath('legacy')), textMessage()));
  await assertSucceeds(set(ref(member, messagePath('system')), { ...textMessage(), type: 'system', createdAt: serverTimestamp() }));
  await seed({ [messagePath('old')]: textMessage({ createdAt: Date.now() - 180001 }), [messagePath('future')]: textMessage({ createdAt: Date.now() + 60000 }) });
  for (const key of ['legacy', 'system', 'old', 'future']) await assertFails(update(ref(member, messagePath(key)), { text: 'Forbidden', editedAt: serverTimestamp() }));
  await assertFails(set(ref(member, messagePath('fake-created')), textMessage({ createdAt: Date.now() + 60000 })));
  await assertFails(set(ref(member, messagePath('already-edited')), textMessage({ createdAt: serverTimestamp(), editedAt: serverTimestamp() })));
  await assertSucceeds(update(ref(member), voicePatch()));
  await assertFails(update(ref(member, messagePath(voiceId)), { text: 'Changed voice', editedAt: serverTimestamp() }));
});

test('chat edits retain ban and revoked-grant enforcement', async () => {
  const member = db('guest-uid'), target = messagePath('trusted');
  await assertSucceeds(set(ref(member, target), textMessage({ createdAt: serverTimestamp() })));
  await seed({ 'roomAccess/ROOM_A/guest-uid': null });
  await assertFails(update(ref(member, target), { text: 'Revoked', editedAt: serverTimestamp() }));
  await seed({ 'roomAccess/ROOM_A/guest-uid': { name: 'Guest', secret: 'fixture-invite-secret' }, 'roomBans/ROOM_A/guest-uid': { name: 'Guest', createdAt: Date.now() } });
  await assertFails(update(ref(member, target), { text: 'Banned', editedAt: serverTimestamp() }));
});

test('room reactions accept the expanded finite mood list and reject arbitrary kinds', async () => {
  const member = db('guest-uid');
  for (const kind of ['like', 'love', 'applause', 'happy', 'sad', 'laugh', 'surprised']) await assertSucceeds(set(ref(member, `rooms/ROOM_A/reactions/${kind}`), { kind, uid: 'guest-uid', user: 'Guest', timestamp: Date.now() }));
  await assertFails(set(ref(member, 'rooms/ROOM_A/reactions/arbitrary'), { kind: 'anything', uid: 'guest-uid', user: 'Guest', timestamp: Date.now() }));
});

test('atomic voice creation is private per slot and bound to immutable matching message metadata', async () => {
  const member = db('guest-uid'), path = 'roomVoiceNotes/ROOM_A/0';
  await assertSucceeds(update(ref(member), voicePatch()));
  await assertSucceeds(get(ref(member, path))); await assertSucceeds(get(ref(db('host-uid'), path)));
  for (const uid of [null, 'outsider-uid']) await assertFails(get(ref(db(uid), path)));
  for (const branch of ['roomVoiceNotes', 'roomVoiceNotes/ROOM_A']) await assertFails(get(ref(member, branch)));
  await assertFails(set(ref(db('host-uid'), path), voiceNote({ uid: 'host-uid' })));
  await assertFails(remove(ref(db('host-uid'), path + '/data')));
  await assertSucceeds(remove(ref(member, path)));
  await assertFails(get(ref(member, path)));
});

test('voice payloads reject malformed, oversized and extra fields at direct and ancestor boundaries', async () => {
  const member = db('guest-uid'), path = 'roomVoiceNotes/ROOM_A/0';
  for (const change of [{ uid: 'host-uid' }, { messageId: '../bad' }, { data: 'data:audio/webm;base64,AQID' }, { data: 'AQ!D' }, { data: '' }, { data: 'A===' }, { bytes: 1 },
    { data: 'A'.repeat(174768) }, { bytes: 0 }, { bytes: 131073 }, { bytes: 1.5 }, { durationMs: 0 }, { durationMs: 15001 },
    { mimeType: 'text/html' }, { createdAt: Date.now() + 60000 }, { extra: true }]) await assertFails(set(ref(member, path), voiceNote(change)));
  for (const slot of ['20', '-1', '01', 'other']) await assertFails(set(ref(member, 'roomVoiceNotes/ROOM_A/' + slot), voiceNote()));
  await assertFails(update(ref(member), { [path]: voiceNote({ extra: true }) }));
  for (const mimeType of ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/ogg;codecs=opus']) await assertSucceeds(set(ref(member, path), voiceNote({ mimeType })));
  await assertSucceeds(set(ref(member, path), voiceNote({ data: Buffer.alloc(131072).toString('base64'), bytes: 131072, durationMs: 15000 })));
  await assertFails(set(ref(member, path), voiceNote({ data: Buffer.alloc(131073).toString('base64'), bytes: 131072 })));
  await assertFails(set(ref(db('outsider-uid'), 'roomVoiceNotes/ROOM_A/1'), voiceNote({ uid: 'outsider-uid' })));
});

test('voice message metadata is strict and audio does not inherit legacy text creation', async () => {
  const member = db('guest-uid'), target = messagePath(voiceId);
  for (const audio of [{ slot: '20', mimeType: 'audio/webm', bytes: 3, durationMs: 1000 }, { slot: '0', mimeType: 'text/html', bytes: 3, durationMs: 1000 },
    { slot: '0', mimeType: 'audio/webm', bytes: 131073, durationMs: 1000 }, { slot: '0', mimeType: 'audio/webm', bytes: 3, durationMs: 15001 },
    { slot: '0', mimeType: 'audio/webm', bytes: 3, durationMs: 1000, url: 'https://other.example' }]) await assertFails(set(ref(member, target), voiceMessage({ audio })));
  const legacy = voiceMessage(); delete legacy.createdAt;
  await assertFails(set(ref(member, target), legacy));
  await assertFails(set(ref(member, target), voiceMessage({ text: 'Other text' })));
});

test('voice reads reject orphan, stale, mismatched and revoked payloads; expired slots can be reclaimed', async () => {
  const member = db('guest-uid'), host = db('host-uid'), path = 'roomVoiceNotes/ROOM_A/0';
  await assertSucceeds(set(ref(member, path), voiceNote()));
  await assertFails(get(ref(member, path)));
  await assertSucceeds(update(ref(member), voicePatch()));
  for (const change of [{ uid: 'host-uid' }, { createdAt: Date.now() - 10 }, { messageId: '-ABCDEFGHIJKLMNOPQRS' }, { bytes: 4 }, { durationMs: 2000 }, { mimeType: 'audio/mp4' }]) {
    await seed({ [path]: { ...voiceNote(), createdAt: Date.now(), ...change } }); await assertFails(get(ref(member, path)));
  }
  await assertSucceeds(update(ref(member), { [messagePath('-ABCDEFGHIJKLMNOPQRS')]: voiceMessage() , [path]: voiceNote({ messageId: '-ABCDEFGHIJKLMNOPQRS' }) }));
  await seed({ 'roomBans/ROOM_A/guest-uid': { name: 'Guest', createdAt: Date.now() } });
  await assertFails(get(ref(member, path))); await assertFails(set(ref(member, path), voiceNote()));
  await seed({ 'roomBans/ROOM_A/guest-uid': null });
  await seed({ 'roomAccess/ROOM_A/guest-uid': null });
  await assertFails(get(ref(member, path))); await assertFails(set(ref(member, path), voiceNote()));
  await seed({ [path]: { ...voiceNote(), createdAt: Date.now() - 86400001 } });
  await assertFails(get(ref(host, path)));
  await assertSucceeds(set(ref(host, path), voiceNote({ uid: 'host-uid' })));
});

test('host cleanup recovers twenty fresh slots occupied by a removed member without rewriting their audio', async () => {
  const member = db('guest-uid'), host = db('host-uid'), patch = {}, clear = {};
  for (let slot = 0; slot < 20; slot++) {
    const id = '-' + String(slot).padStart(19, '0'), createdAt = serverTimestamp();
    const audio = { slot: String(slot), mimeType: 'audio/webm', bytes: 3, durationMs: 1000 };
    patch[messagePath(id)] = voiceMessage({ createdAt, audio });
    patch['roomVoiceNotes/ROOM_A/' + slot] = voiceNote({ messageId: id, createdAt });
    clear['roomVoiceNotes/ROOM_A/' + slot] = null; clear[messagePath(id)] = null;
  }
  await assertSucceeds(update(ref(member), patch));
  await assertSucceeds(update(ref(host), guestRemoval()));
  await assertFails(remove(ref(member, 'roomVoiceNotes/ROOM_A/0')));
  await assertFails(set(ref(host, 'roomVoiceNotes/ROOM_A/0'), voiceNote({ uid: 'host-uid' })));
  await assertFails(update(ref(host, 'roomVoiceNotes/ROOM_A/0'), { uid: 'host-uid', data: 'BAUG', createdAt: serverTimestamp() }));
  await assertSucceeds(update(ref(host), clear));
  // Empty slots are harmless during a repeated cleanup; all historical audio references are gone.
  await assertSucceeds(update(ref(host, 'roomVoiceNotes/ROOM_A'), Object.fromEntries(Array.from({ length: 20 }, (_, slot) => [slot, null]))));
  assert.equal((await get(ref(host, 'rooms/ROOM_A/messages'))).exists(), false);
  const createdAt = serverTimestamp();
  await assertSucceeds(update(ref(host), voicePatch(voiceNote({ uid: 'host-uid', createdAt }), voiceMessage({ uid: 'host-uid', user: 'Host', createdAt }))));
  await assertSucceeds(get(ref(host, 'roomVoiceNotes/ROOM_A/0')));
  assert.equal((await get(ref(host, 'roomVoiceNotes/ROOM_A/0'))).val().uid, 'host-uid');
  await seed({ 'roomAccess/ROOM_A/new-uid': { name: 'New', secret: 'fixture-invite-secret' }, 'rooms/ROOM_A/identities/New': 'new-uid',
    'rooms/ROOM_A/seats/1': { name: 'New', uid: 'new-uid' }, 'rooms/ROOM_A/participants/New/connections/new': true });
  const id = '-ABCDEFGHIJKLMNOPQRS', nextTime = serverTimestamp(), audio = { slot: '1', mimeType: 'audio/webm', bytes: 3, durationMs: 1000 };
  await assertSucceeds(update(ref(db('new-uid')), { [messagePath(id)]: voiceMessage({ uid: 'new-uid', user: 'New', createdAt: nextTime, audio }),
    'roomVoiceNotes/ROOM_A/1': voiceNote({ uid: 'new-uid', messageId: id, createdAt: nextTime }) }));
});

test('voice cleanup is host-only, per-slot and still requires current room authorization', async () => {
  const member = db('guest-uid'), host = db('host-uid'), path = 'roomVoiceNotes/ROOM_A/0';
  await assertSucceeds(set(ref(host, path), voiceNote({ uid: 'host-uid' })));
  await assertFails(remove(ref(member, path)));
  for (const uid of [null, 'outsider-uid']) await assertFails(remove(ref(db(uid), path)));
  await assertFails(remove(ref(host, 'roomVoiceNotes/ROOM_A')));
  await assertFails(remove(ref(host, 'roomVoiceNotes/OTHER/0')));
  await seed({ 'roomAccess/ROOM_A/host-uid': null });
  await assertFails(remove(ref(host, path)));
  await seed({ 'roomAccess/ROOM_A/host-uid': { name: 'Host', secret: 'fixture-invite-secret' }, 'roomBans/ROOM_A/host-uid': { name: 'Host', createdAt: Date.now() } });
  await assertFails(remove(ref(host, path)));
  await seed({ 'roomBans/ROOM_A/host-uid': null });
  await assertSucceeds(remove(ref(host, path)));
});

test('host voice cleanup may delete audio messages but never text, system messages or rewrite audio', async () => {
  const member = db('guest-uid'), host = db('host-uid');
  await assertSucceeds(update(ref(member), voicePatch()));
  await assertSucceeds(set(ref(member, messagePath('text')), textMessage({ createdAt: serverTimestamp() })));
  await assertSucceeds(set(ref(member, messagePath('system')), textMessage({ type: 'system' })));
  await assertFails(remove(ref(member, messagePath(voiceId))));
  await assertFails(update(ref(host, messagePath(voiceId)), { text: 'Rewritten' }));
  await assertFails(remove(ref(host, messagePath('text')))); await assertFails(remove(ref(host, messagePath('system'))));
  await assertFails(remove(ref(host, 'rooms/ROOM_A/messages')));
  await assertFails(update(ref(host), { [messagePath(voiceId)]: null, [messagePath('text')]: null }));
  await assertFails(remove(ref(db('outsider-uid'), messagePath(voiceId))));
  await assertSucceeds(remove(ref(host, messagePath(voiceId))));
  assert.equal((await get(ref(host, messagePath('text')))).val().text, 'Hello');
});

const projectId = 'demo-watch-party';
let env;
const room = () => ({ id: 'ROOM_A', secret: 'fixture-invite-secret', roomSecret: 'fixture-invite-secret',
  host: 'Host', hostUid: 'host-uid', roomName: 'Movie night', createdAt: 1,
  identities: { Host: 'host-uid', Guest: 'guest-uid' }, seats: { 0: { uid: 'host-uid', name: 'Host' }, 1: { uid: 'guest-uid', name: 'Guest' } },
  participants: { Host: { connections: { h: true } }, Guest: { connections: { g: true } } },
  playbackState: 'PAUSED', anchorTime: 0, updatedAt: 0, isPlaying: false, currentTime: 0, videoSource: 'youtube' });
const db = (uid) => uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database();
const ban = (name = 'Guest') => ({ name, createdAt: serverTimestamp() });
const guestRemoval = () => ({
  'roomAccess/ROOM_A/guest-uid': null, 'rooms/ROOM_A/identities/Guest': null,
  'rooms/ROOM_A/seats/1': null, 'rooms/ROOM_A/participants/Guest': null,
  'rooms/ROOM_A/voice/Guest': null, 'rooms/ROOM_A/profiles/Guest': null,
  'rooms/ROOM_A/typing/Guest': null,
});

test('moderation bans are host-owned and private; targets see only their own ban', async () => {
  const path = 'roomBans/ROOM_A/guest-uid';
  for (const uid of [null, 'guest-uid', 'outsider']) await assertFails(set(ref(db(uid), path), ban()));
  await assertFails(set(ref(db('host-uid'), 'roomBans/OTHER/guest-uid'), ban()));
  await assertFails(set(ref(db('host-uid'), 'roomBans/ROOM_A/host-uid'), ban('Host')));
  await assertFails(set(ref(db('host-uid'), 'roomBans/ROOM_A/unknown-uid'), ban()));
  await assertSucceeds(set(ref(db('host-uid'), path), ban()));
  await assertSucceeds(get(ref(db('host-uid'), 'roomBans/ROOM_A')));
  await assertSucceeds(get(ref(db('guest-uid'), path)));
  await assertFails(get(ref(db('guest-uid'), 'roomBans/ROOM_A')));
  await assertFails(get(ref(db('guest-uid'), 'roomBans/ROOM_A/host-uid')));
  await assertFails(get(ref(db('outsider'), path)));
  await assertFails(get(ref(db('host-uid'), 'roomBans')));
});

test('moderation ban records reject malformed fields, identity substitution and future timestamps', async () => {
  const host = db('host-uid'), path = 'roomBans/ROOM_A/guest-uid';
  // Firebase normalizes an empty object to deletion, so it is an unban, not a record.
  for (const value of [true, 'banned', { name: 'Guest' }, { ...ban(), extra: true },
    { ...ban(), name: '' }, { ...ban(), name: 'x'.repeat(41) }, { ...ban(), name: 'Host' },
    { name: 'Guest', createdAt: -1 }, { name: 'Guest', createdAt: Date.now() + 60000 }]) {
    await assertFails(set(ref(host, path), value));
  }
  await assertSucceeds(set(ref(host, path), ban()));
  await assertFails(set(ref(host, path + '/name'), 'Someone else'));
  await assertFails(set(ref(db('guest-uid'), path + '/createdAt'), serverTimestamp()));
});

test('a ban alone revokes room and peer access and forbids re-enrollment despite retained grants', async () => {
  const member = db('guest-uid');
  await assertSucceeds(get(ref(member, 'rooms/ROOM_A')));
  await assertSucceeds(set(ref(db('host-uid'), 'roomBans/ROOM_A/guest-uid'), ban()));
  for (const path of ['rooms/ROOM_A', 'rooms/ROOM_A/identities/Guest', 'rooms/ROOM_A/seats',
    'rooms/ROOM_A/seats/1', 'rooms/ROOM_A/messages', 'roomAccess/ROOM_A/host-uid/name']) await assertFails(get(ref(member, path)));
  await assertFails(get(ref(db('host-uid'), 'roomAccess/ROOM_A/guest-uid/name')));
  await assertSucceeds(get(ref(member, 'roomAccess/ROOM_A/guest-uid')));
  await assertFails(set(ref(member, 'roomAccess/ROOM_A/guest-uid'), { name: 'Guest', secret: 'fixture-invite-secret' }));
  for (const [path, value] of [['participants/Guest/connections/new', true], ['profiles/Guest', { avatar: 'sand' }],
    ['typing/Guest/g', { updatedAt: serverTimestamp() }], ['identities/Guest', 'guest-uid'],
    ['voice/Guest', { id: 'session', muted: false, speaking: false }]]) await assertFails(set(ref(member, 'rooms/ROOM_A/' + path), value));
  await assertFails(set(ref(member, 'rooms/ROOM_A/playbackState'), 'PLAYING'));
});

test('host atomically bans and removes only the target state while preserving host state', async () => {
  await env.withSecurityRulesDisabled(async context => update(ref(context.database(), 'rooms/ROOM_A'), {
    'voice/Guest': { id: 'v', muted: false, speaking: false }, 'profiles/Guest': { avatar: 'sand' },
    'typing/Guest/g': { updatedAt: Date.now() }, screenShare: { id: 'share', owner: 'Guest', ownerUid: 'guest-uid' },
  }));
  const host = db('host-uid');
  await assertSucceeds(update(ref(host), { ...guestRemoval(), 'roomBans/ROOM_A/guest-uid': ban(), 'rooms/ROOM_A/screenShare': null }));
  const after = (await get(ref(host, 'rooms/ROOM_A'))).val();
  assert.equal(after.identities.Host, 'host-uid'); assert.equal(after.identities.Guest, undefined);
  assert.equal(after.seats['0'].uid, 'host-uid'); assert.equal(after.seats['1'], undefined);
  assert.equal(after.participants.Guest, undefined); assert.equal(after.voice, undefined);
  assert.equal(after.screenShare, undefined);
  await assertFails(get(ref(db('guest-uid'), 'rooms/ROOM_A')));
  await assertFails(set(ref(db('guest-uid'), 'roomAccess/ROOM_A/guest-uid'), { name: 'Guest', secret: 'fixture-invite-secret' }));
  await assertSucceeds(set(ref(db('new-uid'), 'roomAccess/ROOM_A/new-uid'), { name: 'New', secret: 'fixture-invite-secret' }));
  await assertSucceeds(set(ref(db('new-uid'), 'rooms/ROOM_A/seats/1'), { uid: 'new-uid', name: 'New' }));
  await assertSucceeds(set(ref(db('new-uid'), 'rooms/ROOM_A/identities/New'), 'new-uid'));
});

test('host moderation cannot delete own identity, grant, seat or presence; members cannot remove peers', async () => {
  const host = db('host-uid'), member = db('guest-uid');
  for (const path of ['roomAccess/ROOM_A/host-uid', 'rooms/ROOM_A/identities/Host', 'rooms/ROOM_A/seats/0', 'rooms/ROOM_A/participants/Host']) {
    await assertFails(remove(ref(host, path)));
    await assertFails(remove(ref(member, path)));
  }
  await assertFails(update(ref(member), guestRemoval()));
  await assertFails(set(ref(host, 'rooms/ROOM_A/identities/Guest'), 'host-uid'));
  await assertFails(set(ref(host, 'rooms/ROOM_A/seats/1'), { uid: 'host-uid', name: 'Host' }));
  await assertFails(update(ref(host), { ...guestRemoval(), 'rooms/ROOM_A/hostUid': 'guest-uid' }));
});

test('removed members may rejoin; banned members must be explicitly unbanned first', async () => {
  const host = db('host-uid'), guest = db('guest-uid');
  const rejoin = async () => {
    await assertSucceeds(set(ref(guest, 'roomAccess/ROOM_A/guest-uid'), { name: 'Guest', secret: 'fixture-invite-secret' }));
    await assertSucceeds(set(ref(guest, 'rooms/ROOM_A/seats/1'), { uid: 'guest-uid', name: 'Guest' }));
    await assertSucceeds(set(ref(guest, 'rooms/ROOM_A/identities/Guest'), 'guest-uid'));
  };
  await assertSucceeds(update(ref(host), guestRemoval())); await rejoin();
  await assertSucceeds(update(ref(host), { ...guestRemoval(), 'roomBans/ROOM_A/guest-uid': ban() }));
  await assertFails(set(ref(guest, 'roomAccess/ROOM_A/guest-uid'), { name: 'Guest', secret: 'fixture-invite-secret' }));
  await assertFails(remove(ref(guest, 'roomBans/ROOM_A/guest-uid')));
  await assertSucceeds(remove(ref(host, 'roomBans/ROOM_A/guest-uid'))); await rejoin();
});

test('live peer admission is cancelled when the host bans the still-enrolled target', async () => {
  let unsubscribe;
  const revoked = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Banned peer listener was not cancelled')), 3000);
    let admitted = false;
    unsubscribe = onValue(ref(db('host-uid'), 'roomAccess/ROOM_A/guest-uid/name'), snapshot => {
      if (snapshot.val() === 'Guest' && !admitted) {
        admitted = true;
        void set(ref(db('host-uid'), 'roomBans/ROOM_A/guest-uid'), ban()).catch(reject);
      }
    }, error => { clearTimeout(timeout); if (!admitted) reject(new Error('Valid peer denied')); else resolve(error.code); });
  });
  try { assert.match(await revoked, /permission.denied/i); } finally { unsubscribe?.(); }
});

test('account profiles and cloud libraries are private, owner-only and strictly bounded', async () => {
  const owner = db('account-a');
  const profile = { displayName: 'Movie fan', photoURL: 'https://lh3.googleusercontent.com/a/photo', sharePhoto: false };
  const item = { source: 'youtube', id: 'abcdefghijk', title: 'Friday movie', position: 42, duration: 100,
    wishlist: true, completed: false, updatedAt: 10, lastWatchedAt: 10 };
  await assertSucceeds(set(ref(owner, 'accounts/account-a/profile'), profile));
  await assertSucceeds(set(ref(owner, 'accounts/account-a/library/0'), item));
  await assertSucceeds(get(ref(owner, 'accounts/account-a')));
  for (const uid of [null, 'account-b']) {
    await assertFails(get(ref(db(uid), 'accounts/account-a')));
    await assertFails(get(ref(db(uid), 'accounts/account-a/library')));
    await assertFails(set(ref(db(uid), 'accounts/account-a/profile'), profile));
    await assertFails(remove(ref(db(uid), 'accounts/account-a/library')));
  }
  await assertFails(get(ref(owner, 'accounts')));
  for (const invalid of [{ ...profile, email: 'private@example.test' }, { ...profile, photoURL: 'https://evil.test/a' },
    { ...profile, photoURL: '', sharePhoto: true }, { ...profile, displayName: 'x'.repeat(41) }])
    await assertFails(set(ref(owner, 'accounts/account-a/profile'), invalid));
  for (const invalid of [{ ...item, roomSecret: 'never-save-this' }, { ...item, source: 'javascript' }, { ...item, position: -1 },
    { ...item, title: 'x'.repeat(121) }, { ...item, id: 'https://evil.test' }])
    await assertFails(set(ref(owner, 'accounts/account-a/library/0'), invalid));
  await assertFails(set(ref(owner, 'accounts/account-a/library/wrong_key'), item));
  await assertFails(set(ref(owner, 'accounts/account-a/library'), Object.fromEntries(Array.from({ length: 51 }, (_, i) => {
    const id = 'video' + String(i).padStart(6, '0'); return [String(i), { ...item, id }];
  }))));
  await assertSucceeds(remove(ref(owner, 'accounts/account-a/library')));
});
test('avatar profiles are member-owned, restricted presets and private to the room', async () => {
  await assertSucceeds(set(ref(db('guest-uid'), 'rooms/ROOM_A/profiles/Guest'), { avatar: 'coral' }));
  await assertSucceeds(set(ref(db('guest-uid'), 'rooms/ROOM_A/profiles/Guest'), { avatar: 'coral', photoURL: 'https://lh3.googleusercontent.com/a/photo' }));
  await assertFails(set(ref(db('guest-uid'), 'rooms/ROOM_A/profiles/Guest'), { avatar: 'coral', photoURL: 'https://evil.test/a' }));
  await assertFails(set(ref(db('guest-uid'), 'rooms/ROOM_A/profiles/Host'), { avatar: 'sand' }));
  await assertFails(set(ref(db('guest-uid'), 'rooms/ROOM_A/profiles/Guest'), { avatar: 'https://evil.example/avatar' }));
  await assertFails(set(ref(db('guest-uid'), 'rooms/ROOM_A/profiles/Guest'), { avatar: 'sand', role: 'host' }));
  await assertFails(get(ref(db('outsider'), 'rooms/ROOM_A/profiles')));
});
test('typing is restricted to own live presence connection and server-bounded timestamps', async () => {
  const member = db('guest-uid'); const own = ref(member, 'rooms/ROOM_A/typing/Guest/g');
  const disconnect = onDisconnect(own); await assertSucceeds(disconnect.remove());
  await assertSucceeds(set(own, { updatedAt: serverTimestamp() }));
  await assertFails(set(ref(member, 'rooms/ROOM_A/typing/Host/h'), { updatedAt: serverTimestamp() }));
  await assertFails(set(ref(member, 'rooms/ROOM_A/typing/Guest/unknown'), { updatedAt: serverTimestamp() }));
  await assertFails(set(own, { updatedAt: Date.now() + 60000 }));
  await assertFails(set(own, { updatedAt: serverTimestamp(), text: 'private draft' }));
  await assertSucceeds(remove(ref(member, 'rooms/ROOM_A/participants/Guest/connections/g')));
  await assertSucceeds(remove(own)); await disconnect.cancel();
});
before(async () => {
  env = await initializeTestEnvironment({ projectId, database: { host: '127.0.0.1', port: 9000,
    rules: await readFile(new URL('../../database.rules.json', import.meta.url), 'utf8') } });
});
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (context) => set(ref(context.database()), {
    rooms: { ROOM_A: room() }, roomAccess: { ROOM_A: { 'host-uid': { name: 'Host', secret: 'fixture-invite-secret' }, 'guest-uid': { name: 'Guest', secret: 'fixture-invite-secret' } } },
  }));
});
after(async () => env?.cleanup());

test('anime favourites are private, bounded and validate canonical metadata IDs', async () => {
  const owner = db('owner-uid'), outsider = db('other-uid');
  const entry = { id: '98444', title: 'Laid-Back Camp', updatedAt: 20 };
  const target = 'accounts/owner-uid/animeFavorites';
  await assertSucceeds(set(ref(owner, target), { 0: entry }));
  await assertSucceeds(get(ref(owner, target)));
  await assertFails(get(ref(outsider, target)));
  await assertFails(set(ref(outsider, target + '/0'), entry));
  for (const invalid of [{ ...entry, id: '../bad' }, { ...entry, id: '0' }, { ...entry, title: '' },
    { ...entry, id: '2147483648' }, { ...entry, token: 'not-a-record-field' }, { ...entry, updatedAt: -1 }]) {
    await assertFails(set(ref(owner, target + '/0'), invalid));
  }
  await assertFails(set(ref(owner, target + '/50'), entry));
  await assertFails(set(ref(owner, target + '/arbitrary'), entry));
  await assertSucceeds(remove(ref(owner, target + '/0')));
});

test('manga library and page positions are owner-only, bounded and contain no image URLs', async () => {
  const id = '58be6aa6-06cb-4ca5-bd20-f1392ce451fb', chapterId = 'ff4f79de-6102-4610-8327-539904cfe549';
  const owner = db('manga-owner'), target = 'accounts/manga-owner/mangaLibrary';
  const value = { id, title: 'Yotsuba', chapterId, page: 3, saved: true, updatedAt: 10 };
  await assertSucceeds(set(ref(owner, target + '/0'), value)); await assertSucceeds(get(ref(owner, target)));
  for (const uid of [null, 'outsider']) { await assertFails(get(ref(db(uid), target))); await assertFails(set(ref(db(uid), target + '/0'), value)); }
  for (const invalid of [{ ...value, page: -1 }, { ...value, page: 500 }, { ...value, page: 1.5 }, { ...value, chapterId: '' }, { ...value, imageUrl: 'not-stored' }, { ...value, id: '../bad' }]) await assertFails(set(ref(owner, target + '/0'), invalid));
  await assertFails(set(ref(owner, target + '/50'), value));
  await assertSucceeds(set(ref(owner, target + '/0'), { ...value, chapterId: '', page: 0 }));
});

test('movie wishlist and progress are private, strictly bounded, and never contain playback URLs', async () => {
  const owner = db('movie-owner'), target = 'accounts/movie-owner/movieLibrary';
  const value = { kind: 'movie', id: '10378', title: 'Big Buck Bunny', wishlist: true, position: 42, duration: 300, season: 0, episode: 0, completed: false, updatedAt: 20, lastWatchedAt: 20 };
  await assertSucceeds(set(ref(owner, target + '/0'), value)); await assertSucceeds(get(ref(owner, target)));
  for (const uid of [null, 'outsider']) { await assertFails(get(ref(db(uid), target))); await assertFails(set(ref(db(uid), target + '/0'), value)); await assertFails(remove(ref(db(uid), target))); }
  for (const invalid of [{ ...value, id: '0' }, { ...value, id: '2147483648' }, { ...value, position: -1 }, { ...value, position: 301 }, { ...value, duration: 604801 }, { ...value, season: 1 }, { ...value, kind: 'tv', episode: 0 }, { ...value, sourceUrl: 'https://private.example/video' }, { ...value, title: 'x'.repeat(121) }]) await assertFails(set(ref(owner, target + '/0'), invalid));
  await assertFails(set(ref(owner, target + '/50'), value));
  await assertSucceeds(set(ref(owner, target + '/0'), { ...value, kind: 'tv', id: '1399', season: 0, episode: 1 }));
  await assertSucceeds(set(ref(owner, target + '/0'), { ...value, kind: 'tv', position: 0, duration: 0, lastWatchedAt: 0 }));
});

test('movie library rejects scalar containers while preserving valid writes and deletion', async () => {
  const owner = db('movie-owner'), target = ref(owner, 'accounts/movie-owner/movieLibrary');
  for (const scalar of ['x'.repeat(65536), true, 42]) await assertFails(set(target, scalar));
  await assertFails(update(ref(owner), { 'accounts/movie-owner/movieLibrary': 'scalar-update' }));
  await assertFails(runTransaction(target, () => 'scalar-transaction'));
  await assertFails(set(ref(owner, 'accounts/movie-owner/movieLibrary/0'), 'scalar-item'));
  const value = { kind: 'movie', id: '10378', title: 'Big Buck Bunny', wishlist: true, position: 0, duration: 0, season: 0, episode: 0, completed: false, updatedAt: 20, lastWatchedAt: 0 };
  await assertSucceeds(runTransaction(target, () => ({ 49: value })));
  await assertSucceeds(remove(ref(owner, 'accounts/movie-owner/movieLibrary/49')));
  await env.withSecurityRulesDisabled(context => set(ref(context.database(), 'accounts/movie-owner/movieLibrary'), 'legacy-scalar'));
  await assertSucceeds(runTransaction(target, () => ({ 0: value })));
  await assertSucceeds(runTransaction(target, () => null));
  await assertSucceeds(set(target, { 0: value }));
  await assertSucceeds(remove(target));
});

test('denies unauthenticated and nonmember reads at the room and sensitive children', async () => {
  for (const uid of [null, 'outsider-uid']) for (const path of ['rooms', 'rooms/ROOM_A', 'rooms/ROOM_A/secret', 'rooms/ROOM_A/messages']) await assertFails(get(ref(db(uid), path)));
  await assertSucceeds(get(ref(db('guest-uid'), 'rooms/ROOM_A')));
});

test('anime selection is atomic and bounded, while only the host may play, pause and seek', async () => {
  const host = db('host-uid'), member = db('guest-uid'), path = 'rooms/ROOM_A';
  const selection = { videoSource: 'anime', videoId: 'ap_naruto', animeEpisode: 1, animeTitle: 'Naruto', mediaSelectionId: 'anime-first',
    playbackState: 'PAUSED', anchorTime: 0, currentTime: 0, isPlaying: false, updatedAt: Date.now() };
  await assertSucceeds(update(ref(member, path), selection));
  await assertFails(update(ref(member, path), { playbackState: 'PLAYING', isPlaying: true, updatedAt: Date.now() }));
  await assertSucceeds(update(ref(host, path), { playbackState: 'PLAYING', isPlaying: true, anchorTime: 20, updatedAt: Date.now() }));
  await assertFails(set(ref(member, path + '/animeEpisode'), 2));
  for (const invalid of [{ ...selection, animeEpisode: 0 }, { ...selection, animeEpisode: 1.5 }, { ...selection, animeEpisode: null },
    { ...selection, videoId: 'https://stream.example/secret' }, { ...selection, sourceUrl: 'never-store' }]) await assertFails(update(ref(host, path), { ...invalid, mediaSelectionId: 'bad' }));
  await assertSucceeds(update(ref(host, path), { ...selection, animeEpisode: 2, mediaSelectionId: 'anime-second' }));
  await assertFails(update(ref(db('outsider'), path), { ...selection, mediaSelectionId: 'outsider' }));
  // Old clients may leave ignored, bounded anime fields when returning to another source.
  await assertSucceeds(update(ref(member, path), { videoSource: 'youtube', videoId: 'abcdefghijk', mediaSelectionId: 'old-client-return', playbackState: 'PAUSED', anchorTime: 0, currentTime: 0, isPlaying: false, updatedAt: Date.now() }));
});

test('initial anime room creation rejects missing or forged episode metadata', async () => {
  const owner = db('host-uid');
  const initial = { ...room(), id: 'ANIME_CREATE', videoSource: 'anime', videoId: 'ap_naruto', animeEpisode: 1, animeTitle: 'Naruto', mediaSelectionId: 'initial',
    identities: { Host: 'host-uid' }, seats: { 0: { uid: 'host-uid', name: 'Host' } }, participants: {} };
  const noEpisode = { ...initial }; delete noEpisode.animeEpisode;
  await assertFails(set(ref(owner, 'rooms/ANIME_CREATE'), noEpisode));
  await assertSucceeds(set(ref(owner, 'rooms/ANIME_CREATE'), initial));
});

test('movie selections are bounded atomic changes and preserve host-only playback authority', async () => {
  const host = db('host-uid'), member = db('guest-uid'), path = 'rooms/ROOM_A';
  const selected = { videoSource: 'movie', videoId: '10378', movieKind: 'movie', movieTitle: 'Big Buck Bunny', movieSeason: 0, movieEpisode: 0, mediaSelectionId: 'movie-first',
    playbackState: 'PAUSED', anchorTime: 0, currentTime: 0, isPlaying: false, updatedAt: Date.now() };
  await assertSucceeds(update(ref(member, path), selected));
  await assertFails(update(ref(member, path), { playbackState: 'PLAYING', isPlaying: true, updatedAt: Date.now() }));
  await assertSucceeds(update(ref(host, path), { playbackState: 'PLAYING', isPlaying: true, anchorTime: 20, updatedAt: Date.now() }));
  await assertFails(set(ref(member, path + '/movieEpisode'), 2));
  for (const invalid of [{ movieKind: 'other' }, { movieTitle: '' }, { movieTitle: 'x'.repeat(121) }, { videoId: 'https://private.example' }, { videoId: '2147483648' },
    { movieKind: 'tv', movieSeason: -1, movieEpisode: 1 }, { movieKind: 'tv', movieSeason: 1, movieEpisode: 0 }, { movieKind: 'tv', movieSeason: 1.5, movieEpisode: 1 }, { sourceUrl: 'never-store' }]) {
    await assertFails(update(ref(host, path), { ...selected, ...invalid, mediaSelectionId: 'bad' }));
  }
  await assertSucceeds(update(ref(host, path), { ...selected, movieKind: 'tv', movieSeason: 0, movieEpisode: 2, mediaSelectionId: 'tv-second' }));
  await assertFails(update(ref(db('outsider'), path), { ...selected, mediaSelectionId: 'outsider' }));
  await assertSucceeds(update(ref(member, path), { videoSource: 'youtube', videoId: 'abcdefghijk', mediaSelectionId: 'legacy-return', playbackState: 'PAUSED', anchorTime: 0, currentTime: 0, isPlaying: false, updatedAt: Date.now() }));
});
test('new movie rooms require complete movie selection metadata', async () => {
  const initial = { ...room(), id: 'MOVIE_CREATE', videoSource: 'movie', videoId: '10378', movieKind: 'movie', movieTitle: 'Big Buck Bunny', movieSeason: 0, movieEpisode: 0, mediaSelectionId: 'first',
    identities: { Host: 'host-uid' }, seats: { 0: { uid: 'host-uid', name: 'Host' } }, participants: {} };
  const missing = { ...initial }; delete missing.movieKind;
  await assertFails(set(ref(db('host-uid'), 'rooms/MOVIE_CREATE'), missing));
  await assertSucceeds(set(ref(db('host-uid'), 'rooms/MOVIE_CREATE'), initial));
});

test('provider wishlist is private and bounded without weakening legacy title or room validation', async () => {
  const owner = db('owner-uid'), path = 'accounts/owner-uid/paradiseFavorites';
  const item = { id: 'ap_sousou-no-frieren', title: 'Frieren', updatedAt: 20 };
  await assertSucceeds(set(ref(owner, path + '/0'), item));
  await assertSucceeds(get(ref(owner, path)));
  for (const uid of [null, 'outsider']) {
    await assertFails(get(ref(db(uid), path))); await assertFails(set(ref(db(uid), path + '/0'), item));
  }
  for (const invalid of [{ ...item, id: 'ap_../bad' }, { ...item, sourceUrl: 'https://secret.example' }, { ...item, title: '' }]) await assertFails(set(ref(owner, path + '/0'), invalid));
  await assertFails(set(ref(owner, path + '/50'), item));
  await assertFails(set(ref(owner, 'accounts/owner-uid/animeFavorites/0'), item));
});
test('requires a correct invitation for enrollment and reserves names to their UID', async () => {
  const outsider = db('new-uid');
  await assertFails(set(ref(outsider, 'roomAccess/ROOM_A/new-uid'), { name: 'New', secret: 'wrong' }));
  await assertFails(set(ref(outsider, 'roomAccess/ROOM_A/guest-uid'), { name: 'New', secret: 'fixture-invite-secret' }));
  await assertSucceeds(set(ref(outsider, 'roomAccess/ROOM_A/new-uid'), { name: 'New', secret: 'fixture-invite-secret' }));
  await assertSucceeds(set(ref(outsider, 'rooms/ROOM_A/seats/2'), { uid: 'new-uid', name: 'New' }));
  await assertFails(set(ref(outsider, 'rooms/ROOM_A/identities/Host'), 'new-uid'));
  await assertSucceeds(set(ref(outsider, 'rooms/ROOM_A/identities/New'), 'new-uid'));
  await assertSucceeds(get(ref(outsider, 'rooms/ROOM_A')));
  await assertFails(get(ref(outsider, 'roomAccess/ROOM_A/host-uid')));
});
test('prevents takeover, ancestor replacement, sibling writes and cross-room access', async () => {
  const member = db('guest-uid');
  for (const [path, value] of [['hostUid','guest-uid'], ['host','Guest'], ['secret','new-secret'], ['roomSecret','new-secret'], ['hostSessionId','forged'], ['unknown','x'], ['identities/Host','guest-uid'], ['participants/Host/connections/forged',true]]) await assertFails(set(ref(member, 'rooms/ROOM_A/'+path), value));
  await assertFails(remove(ref(member, 'rooms/ROOM_A')));
  await assertFails(set(ref(member, 'rooms/ROOM_A'), { ...room(), hostUid: 'guest-uid' }));
  await assertFails(update(ref(member), { 'rooms/ROOM_A/hostUid': 'guest-uid', 'rooms/OTHER/hostUid': 'guest-uid' }));
  await assertFails(get(ref(member, 'rooms/OTHER')));
});
test('permits only valid members to observe another admitted member name, never their grant or secret', async () => {
  for (const [reader, target] of [['host-uid', 'guest-uid'], ['guest-uid', 'host-uid']]) {
    await assertSucceeds(get(ref(db(reader), `roomAccess/ROOM_A/${target}/name`)));
    await assertFails(get(ref(db(reader), `roomAccess/ROOM_A/${target}`)));
    await assertFails(get(ref(db(reader), `roomAccess/ROOM_A/${target}/secret`)));
  }
  for (const uid of [null, 'outsider-uid']) await assertFails(get(ref(db(uid), 'roomAccess/ROOM_A/guest-uid/name')));
  await assertFails(get(ref(db('guest-uid'), 'roomAccess/OTHER/host-uid/name')));
});
test('live peer admission is cancelled on grant deletion and on a secret change outside the watched name', async () => {
  for (const mutate of [
    (admin) => remove(ref(admin, 'roomAccess/ROOM_A/guest-uid')),
    (admin) => set(ref(admin, 'roomAccess/ROOM_A/guest-uid/secret'), 'no-longer-valid'),
  ]) {
    await env.withSecurityRulesDisabled(async (context) => set(ref(context.database(), 'roomAccess/ROOM_A/guest-uid'), { name: 'Guest', secret: 'fixture-invite-secret' }));
    let unsubscribe, admitted = false;
    const revoked = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Peer authorization listener was not cancelled')), 3000);
      unsubscribe = onValue(ref(db('host-uid'), 'roomAccess/ROOM_A/guest-uid/name'), (snapshot) => {
        if (snapshot.val() === 'Guest' && !admitted) { admitted = true; void env.withSecurityRulesDisabled((context) => mutate(context.database())).catch(reject); }
      }, (error) => { clearTimeout(timeout); if (!admitted) reject(new Error('Valid peer admission was denied')); else resolve(error.code); });
    });
    try { assert.match(await revoked, /permission.denied/i); } finally { unsubscribe?.(); }
  }
});
test('preserves create, own presence, host clock, member media selection and host sessions', async () => {
  const host = db('host-uid'), member = db('guest-uid');
  await assertSucceeds(set(ref(host, 'rooms/NEW_ROOM'), { ...room(), id: 'NEW_ROOM', identities: { Host: 'host-uid' }, seats: { 0: { uid: 'host-uid', name: 'Host' } }, participants: {} }));
  await assertSucceeds(set(ref(host, 'rooms/BOOKMARK'), { ...room(), id: 'BOOKMARK', identities: { Host: 'host-uid' }, seats: { 0: { uid: 'host-uid', name: 'Host' } },
    participants: {}, videoId: 'abcdefghijk', currentTime: 40, anchorTime: 40, updatedAt: serverTimestamp() }));
  await assertSucceeds(set(ref(member, 'rooms/ROOM_A/participants/Guest/connections/second-tab'), true));
  await assertSucceeds(remove(ref(member, 'rooms/ROOM_A/participants/Guest/connections/g')));
  await assertSucceeds(update(ref(host, 'rooms/ROOM_A'), { playbackState: 'PLAYING', anchorTime: 37, updatedAt: Date.now(), isPlaying: true, currentTime: 37 }));
  await assertFails(update(ref(member, 'rooms/ROOM_A'), { playbackState: 'PLAYING', anchorTime: 200 }));
  await assertSucceeds(update(ref(member, 'rooms/ROOM_A'), { mediaSelectionId: 'new-selection', videoId: 'abcdefghijk', videoSource: 'youtube', playbackState: 'PAUSED', anchorTime: 0, updatedAt: Date.now(), isPlaying: false, currentTime: 0 }));
  await assertSucceeds(set(ref(host, 'rooms/ROOM_A/hostPresence/session'), { user: 'Host', online: true, startedAt: Date.now() }));
  await assertFails(set(ref(member, 'rooms/ROOM_A/hostPresence/fake'), { user: 'Host', online: true, startedAt: Date.now() }));
});
test('only the screen owner may release a broadcast; claims cannot overwrite an active share', async () => {
  const host = db('host-uid'), member = db('guest-uid');
  await assertSucceeds(set(ref(member, 'rooms/ROOM_A/screenShare'), { id: 'broadcast', owner: 'Guest', ownerUid: 'guest-uid' }));
  await assertFails(remove(ref(host, 'rooms/ROOM_A/screenShare')));
  await assertFails(set(ref(host, 'rooms/ROOM_A/screenShare'), { id: 'new', owner: 'Host', ownerUid: 'host-uid' }));
  await assertSucceeds(runTransaction(ref(member, 'rooms/ROOM_A/screenShare'), (current) => current?.id === 'broadcast' ? null : undefined));
});

test('arms screen cleanup before publication, protects active markers and permits inactive replacement only', async () => {
  const host = db('host-uid'), member = db('guest-uid');
  const share = (id, owner = 'Guest', ownerUid = 'guest-uid') => ({ version: 2, id, owner, ownerUid, connections: { [id]: true } });
  const cleanup = onDisconnect(ref(member, 'rooms/ROOM_A/screenShare/connections/old'));
  await assertSucceeds(cleanup.remove());
  await assertSucceeds(set(ref(member, 'rooms/ROOM_A/screenShare'), share('old')));
  await assertFails(remove(ref(host, 'rooms/ROOM_A/screenShare/connections/old')));
  await assertFails(set(ref(host, 'rooms/ROOM_A/screenShare'), share('rival', 'Host', 'host-uid')));
  const request = { from: 'Host', sessionId: 'old', nonce: 'live', requestedAt: Date.now() };
  await assertSucceeds(set(ref(host, 'rooms/ROOM_A/webrtc/requests/Guest/Host'), request));
  await assertSucceeds(remove(ref(member, 'rooms/ROOM_A/screenShare/connections/old')));
  await assertFails(set(ref(host, 'rooms/ROOM_A/webrtc/requests/Guest/Host'), { ...request, nonce: 'stale' }));
  await assertSucceeds(set(ref(host, 'rooms/ROOM_A/screenShare'), share('new', 'Host', 'host-uid')));
  await assertSucceeds(remove(ref(member, 'rooms/ROOM_A/screenShare/connections/old')));
  assert.equal((await get(ref(host, 'rooms/ROOM_A/screenShare/connections/new'))).val(), true);
  await assertSucceeds(cleanup.cancel());
});

test('preserves a legacy live share and reclaims it only after its owner is offline', async () => {
  const host = db('host-uid'), member = db('guest-uid');
  await assertSucceeds(set(ref(member, 'rooms/ROOM_A/screenShare'), { id: 'legacy', owner: 'Guest', ownerUid: 'guest-uid' }));
  const replacement = { version: 2, id: 'new', owner: 'Host', ownerUid: 'host-uid', connections: { new: true } };
  await assertFails(set(ref(host, 'rooms/ROOM_A/screenShare'), replacement));
  await assertSucceeds(remove(ref(member, 'rooms/ROOM_A/participants/Guest/connections/g')));
  await assertSucceeds(set(ref(host, 'rooms/ROOM_A/screenShare'), replacement));
});
test('host disconnect cleanup can be armed before its online node is published', async () => {
  const host = db('host-uid'), member = db('guest-uid');
  const cleanup = onDisconnect(ref(host, 'rooms/ROOM_A/hostPresence/new-session'));
  await assertSucceeds(cleanup.update({ online: false, endedAt: serverTimestamp() }));
  await assertSucceeds(cleanup.cancel());
  await assertFails(onDisconnect(ref(member, 'rooms/ROOM_A/hostPresence/forged')).update({ online: false, endedAt: serverTimestamp() }));
});
test('binds chat and reactions to the writer and rejects edits and forged authors', async () => {
  const member = db('guest-uid');
  const message = { type: 'user', uid: 'guest-uid', user: 'Guest', text: 'Hello', time: '10:00', timestamp: Date.now() };
  await assertSucceeds(set(ref(member, 'rooms/ROOM_A/messages/m1'), message));
  await assertFails(set(ref(member, 'rooms/ROOM_A/messages/m1'), { ...message, text: 'edited' }));
  await assertFails(set(ref(member, 'rooms/ROOM_A/messages/m2'), { ...message, user: 'Host' }));
  await assertSucceeds(set(ref(member, 'rooms/ROOM_A/reactions/r1'), { kind: 'like', user: 'Guest', uid: 'guest-uid', timestamp: Date.now() }));
  await assertFails(set(ref(member, 'rooms/ROOM_A/reactions/r2'), { kind: 'like', user: 'Host', uid: 'guest-uid', timestamp: Date.now() }));
});
test('rejects signaling for absent participants, forged senders and stale broadcasts', async () => {
  const host = db('host-uid'), member = db('guest-uid');
  await assertSucceeds(set(ref(host, 'rooms/ROOM_A/screenShare'), { id: 'broadcast', owner: 'Host', ownerUid: 'host-uid' }));
  const request = { from: 'Guest', sessionId: 'broadcast', nonce: 'request', requestedAt: Date.now() };
  await assertSucceeds(set(ref(member, 'rooms/ROOM_A/webrtc/requests/Host/Guest'), request));
  await assertFails(set(ref(member, 'rooms/ROOM_A/webrtc/requests/Host/Absent'), { ...request, from: 'Absent' }));
  await assertFails(set(ref(member, 'rooms/ROOM_A/webrtc/requests/Host/Guest'), { ...request, sessionId: 'old' }));
  const offer = { from: 'Host', sessionId: 'broadcast', connectionId: 'connection', sdp: { type: 'offer', sdp: 'fixture' } };
  await assertSucceeds(set(ref(host, 'rooms/ROOM_A/webrtc/offers/Guest'), offer));
  await assertFails(set(ref(member, 'rooms/ROOM_A/webrtc/offers/Host'), { ...offer, from: 'Guest' }));
});
test('voice requires both endpoints to opt in and only the owner can change microphone state', async () => {
  const host = db('host-uid'), member = db('guest-uid');
  await assertSucceeds(set(ref(member, 'rooms/ROOM_A/voice/Guest'), { id: 'guest-voice', muted: false, speaking: false, connections: { 'guest-voice': true } }));
  await assertFails(update(ref(host, 'rooms/ROOM_A/voice/Guest'), { muted: true }));
  const offer = { from: 'Host', fromSession: 'host-voice', toSession: 'guest-voice', connectionId: 'voice-connection', sdp: { type: 'offer', sdp: 'fixture' } };
  await assertFails(set(ref(host, 'rooms/ROOM_A/voiceSignals/offers/Guest/Host'), offer));
  await assertSucceeds(set(ref(host, 'rooms/ROOM_A/voice/Host'), { id: 'host-voice', muted: false, speaking: false, connections: { 'host-voice': true } }));
  await assertSucceeds(set(ref(host, 'rooms/ROOM_A/voiceSignals/offers/Guest/Host'), offer));
  await assertFails(set(ref(member, 'rooms/ROOM_A/voiceSignals/offers/Host/Guest'), { ...offer, from: 'Host' }));
});

test('rejects unreserved aliases, seventh seats and seats belonging to another UID', async () => {
  for (let i = 2; i < 6; i++) {
    const member = db('uid-'+i), name = 'User'+i;
    await assertSucceeds(set(ref(member, `roomAccess/ROOM_A/uid-${i}`), { name, secret: 'fixture-invite-secret' }));
    await assertSucceeds(set(ref(member, `rooms/ROOM_A/seats/${i}`), { uid: 'uid-'+i, name }));
    await assertSucceeds(set(ref(member, `rooms/ROOM_A/identities/${name}`), 'uid-'+i));
  }
  const extra = db('extra');
  await assertSucceeds(set(ref(extra, 'roomAccess/ROOM_A/extra'), { name: 'Extra', secret: 'fixture-invite-secret' }));
  await assertFails(set(ref(extra, 'rooms/ROOM_A/seats/6'), { uid: 'extra', name: 'Extra' }));
  await assertFails(set(ref(extra, 'rooms/ROOM_A/seats/1'), { uid: 'extra', name: 'Extra' }));
  await assertFails(set(ref(extra, 'rooms/ROOM_A/identities/Extra'), 'extra'));
  await assertFails(set(ref(db('guest-uid'), 'rooms/ROOM_A/seats/5'), { uid: 'guest-uid', name: 'Guest' }));
});
test('permits changing a collided unclaimed name but freezes a bound name and invitation', async () => {
  const member = db('new-uid'), grant = ref(member, 'roomAccess/ROOM_A/new-uid');
  await assertSucceeds(set(grant, { name: 'Host', secret: 'fixture-invite-secret' }));
  await assertSucceeds(set(ref(member, 'rooms/ROOM_A/seats/2'), { uid: 'new-uid', name: 'Host' }));
  await assertSucceeds(set(grant, { name: 'New', secret: 'fixture-invite-secret' }));
  await assertSucceeds(set(ref(member, 'rooms/ROOM_A/seats/2'), { uid: 'new-uid', name: 'New' }));
  await assertSucceeds(set(ref(member, 'rooms/ROOM_A/identities/New'), 'new-uid'));
  await assertSucceeds(set(grant, { name: 'New', secret: 'fixture-invite-secret' }));
  await assertFails(set(grant, { name: 'Other', secret: 'fixture-invite-secret' }));
  await assertFails(set(grant, { name: 'New', secret: 'wrong-secret' }));
});
test('authorizes atomic screen claim plus media reset, but rejects competing claims and root replacement', async () => {
  const member = db('guest-uid'), host = db('host-uid');
  const patch = { screenShare: { id: 'broadcast', owner: 'Guest', ownerUid: 'guest-uid' }, mediaSelectionId: 'screen-selection', videoId: null,
    videoSource: 'youtube', playbackState: 'PAUSED', anchorTime: 0, updatedAt: Date.now(), isPlaying: false, currentTime: 0 };
  await assertSucceeds(update(ref(member, 'rooms/ROOM_A'), patch));
  await assertFails(update(ref(host, 'rooms/ROOM_A'), { ...patch, screenShare: { id: 'competing', owner: 'Host', ownerUid: 'host-uid' } }));
  await assertFails(set(ref(member, 'rooms/ROOM_A/webrtc'), { anything: 'ancestor-bypass' }));
});
test('bounds ICE slots and rejects forged ICE senders and stale sessions', async () => {
  const host = db('host-uid'), member = db('guest-uid');
  await assertSucceeds(set(ref(host, 'rooms/ROOM_A/screenShare'), { id: 'broadcast', owner: 'Host', ownerUid: 'host-uid' }));
  const candidate = { from: 'Host', sessionId: 'broadcast', connectionId: 'connection', ice: { candidate: 'fixture' } };
  await assertSucceeds(set(ref(host, 'rooms/ROOM_A/webrtc/ice/Guest/Host/0'), candidate));
  await assertFails(set(ref(host, 'rooms/ROOM_A/webrtc/ice/Guest/Host/32'), candidate));
  await assertFails(set(ref(member, 'rooms/ROOM_A/webrtc/ice/Host/Guest/0'), candidate));
  await assertFails(set(ref(host, 'rooms/ROOM_A/webrtc/ice/Guest/Host/1'), { ...candidate, sessionId: 'old' }));
  await assertSucceeds(remove(ref(member, 'rooms/ROOM_A/webrtc/ice/Guest/Host/0')));
});
test('old microphone disconnect cleanup cannot remove a newer session or negotiate with an inactive microphone', async () => {
  const member = db('guest-uid'), host = db('host-uid');
  await assertSucceeds(set(ref(member, 'rooms/ROOM_A/voice/Guest'), { id: 'old', muted: false, speaking: false, connections: { old: true } }));
  await assertSucceeds(remove(ref(member, 'rooms/ROOM_A/voice/Guest/connections/old')));
  await assertSucceeds(set(ref(member, 'rooms/ROOM_A/voice/Guest'), { id: 'new', muted: false, speaking: false, connections: { new: true } }));
  await assertSucceeds(remove(ref(member, 'rooms/ROOM_A/voice/Guest/connections/old')));
  assert.equal((await get(ref(member, 'rooms/ROOM_A/voice/Guest/connections/new'))).val(), true);
  await assertSucceeds(set(ref(host, 'rooms/ROOM_A/voice/Host'), { id: 'host-voice', muted: false, speaking: false, connections: { 'host-voice': true } }));
  const request = { from: 'Guest', fromSession: 'new', toSession: 'host-voice', connectionId: 'connection', nonce: 'request' };
  await assertSucceeds(set(ref(member, 'rooms/ROOM_A/voiceSignals/requests/Host/Guest'), request));
  const ice = { from: 'Guest', fromSession: 'new', toSession: 'host-voice', connectionId: 'connection', ice: { candidate: 'fixture' } };
  await assertSucceeds(set(ref(member, 'rooms/ROOM_A/voiceSignals/ice/Host/Guest/0'), ice));
  await assertSucceeds(remove(ref(host, 'rooms/ROOM_A/voiceSignals/ice/Host/Guest/0')));
  await assertSucceeds(remove(ref(member, 'rooms/ROOM_A/voice/Guest/connections/new')));
  await assertFails(set(ref(member, 'rooms/ROOM_A/voiceSignals/requests/Host/Guest'), { ...request, nonce: 'second' }));
});

test('real Auth emulator identities can create a private room while another signed-in identity cannot read it', async () => {
  const apps = [], databases = [];
  try {
    const clients = ['owner','outsider'].map((name) => {
      const app = initializeApp({ projectId, apiKey: 'demo-local-key', databaseURL: `https://${projectId}.firebaseio.com` }, 'auth-'+name);
      apps.push(app);
      const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      const database = getDatabase(app); connectDatabaseEmulator(database, '127.0.0.1', 9000);
      databases.push(database);
      return { auth, database, signIn: createAnonymousSession(auth, signInAnonymously) };
    });
    const deadline = (promise, stage) => { let timer; return Promise.race([promise, new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('Local auth test deadline: '+stage)), 12000); })]).finally(() => clearTimeout(timer)); };
    const [owner, sameOwner] = await deadline(Promise.all([clients[0].signIn(), clients[0].signIn()]), 'owner sign-in');
    assert.equal(owner.uid, sameOwner.uid);
    await deadline(clients[1].signIn(), 'outsider sign-in');
    const created = { ...room(), id: 'AUTH_ROOM', hostUid: owner.uid, identities: { Host: owner.uid },
      seats: { 0: { uid: owner.uid, name: 'Host' } }, participants: {} };
    await deadline(assertSucceeds(set(ref(clients[0].database, 'rooms/AUTH_ROOM'), created)), 'owner room creation');
    await assertSucceeds(get(ref(clients[0].database, 'rooms/AUTH_ROOM')));
    await assertFails(get(ref(clients[1].database, 'rooms/AUTH_ROOM')));
  } finally { databases.forEach(goOffline); await Promise.all(apps.map((app) => deleteApp(app))); }
});
