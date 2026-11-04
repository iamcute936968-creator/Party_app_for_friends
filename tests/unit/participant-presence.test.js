import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, push, set, remove, get, onValue, onDisconnect } from '../helpers/firebase-database';
import { createParticipantPresence, getOnlineParticipants } from '../../src/presence/participantPresence';

let subscriptions;
let disconnects;
let count;
const database = {};
const snapshot = (value) => ({ val: () => value });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  subscriptions = [];
  disconnects = [];
  count = 0;
  ref.mockImplementation((_db, path) => ({ path }));
  push.mockImplementation((parent) => ({ path: `${parent.path}/connection_${++count}` }));
  set.mockResolvedValue();
  remove.mockResolvedValue();
  get.mockResolvedValue(snapshot(null));
  onDisconnect.mockImplementation((target) => {
    const value = { target, remove: vi.fn().mockResolvedValue(), cancel: vi.fn().mockResolvedValue() };
    disconnects.push(value);
    return value;
  });
  onValue.mockImplementation((target, next, error) => {
    const unsubscribe = vi.fn();
    subscriptions.push({ target, next, error, unsubscribe });
    return unsubscribe;
  });
});

describe('participant presence compatibility', () => {
  it('exposes the active SDK connection key for connection-owned features', async () => {
    push.mockReturnValueOnce({ path: '/rooms/ROOM_A/participants/Guest/connections/sdk-key', key: 'sdk-key' });
    const presence = createParticipantPresence(database, 'ROOM_A', 'Guest', vi.fn());
    await subscriptions[0].next(snapshot(true));
    expect(presence.connectionId).toBe('sdk-key');
    await presence.leave();
  });
  it('reads legacy booleans and active connection objects without counting empty or offline entries', () => {
    expect(getOnlineParticipants({
      Legacy: true, Offline: false, Alice: { connections: { tab1: true, tab2: true } },
      Bob: { connections: { tab: false } }, Empty: { connections: {} }, Invalid: {}, Null: null,
    })).toEqual(['Legacy', 'Alice']);
    expect(getOnlineParticipants(null)).toEqual([]);
  });

  it('requires true connection markers rather than accepting arbitrary truthy data', () => {
    expect(getOnlineParticipants({ A: { connections: { x: 'true' } }, B: { connections: { x: 1 } } })).toEqual([]);
  });
});

describe('connection-scoped participant presence', () => {
  it('waits for connection and arms disconnect removal before publishing presence', async () => {
    const status = vi.fn();
    const presence = createParticipantPresence(database, 'ROOM_A', 'Guest', status);
    expect(subscriptions[0].target.path).toBe('.info/connected');
    await subscriptions[0].next(snapshot(false));
    expect(set).not.toHaveBeenCalled();
    await subscriptions[0].next(snapshot(true));
    expect(set).toHaveBeenCalledWith({ path: '/rooms/ROOM_A/participants/Guest/connections/connection_1' }, true);
    expect(disconnects[0].remove.mock.invocationCallOrder[0]).toBeLessThan(set.mock.invocationCallOrder[0]);
    expect(status).toHaveBeenLastCalledWith({ ready: true, error: null });
    await presence.leave();
  });

  it('gives two tabs independent keys and removes only the leaving tab', async () => {
    const first = createParticipantPresence(database, 'ROOM_A', 'Guest', vi.fn());
    const second = createParticipantPresence(database, 'ROOM_A', 'Guest', vi.fn());
    await subscriptions[0].next(snapshot(true));
    await subscriptions[1].next(snapshot(true));
    get.mockResolvedValue(snapshot({ connections: { connection_2: true } }));
    expect(await first.leave()).toBe(false);
    expect(remove).toHaveBeenCalledWith({ path: '/rooms/ROOM_A/participants/Guest/connections/connection_1' });
    expect(remove).not.toHaveBeenCalledWith({ path: '/rooms/ROOM_A/participants/Guest' });
    expect(remove).not.toHaveBeenCalledWith({ path: '/rooms/ROOM_A/participants/Guest/connections/connection_2' });
    get.mockResolvedValue(snapshot(null));
    expect(await second.leave()).toBe(true);
  });

  it('creates a fresh session after reconnect and retires old session keys', async () => {
    const status = vi.fn();
    const presence = createParticipantPresence(database, 'ROOM_A', 'Guest', status);
    await subscriptions[0].next(snapshot(true));
    await subscriptions[0].next(snapshot(false));
    expect(status).toHaveBeenLastCalledWith({ ready: false, error: null });
    await subscriptions[0].next(snapshot(true));
    expect(set).toHaveBeenLastCalledWith({ path: '/rooms/ROOM_A/participants/Guest/connections/connection_2' }, true);
    expect(remove).toHaveBeenCalledWith({ path: '/rooms/ROOM_A/participants/Guest/connections/connection_1' });
    await presence.leave();
  });

  it('does not publish after leaving while disconnect registration is pending', async () => {
    const registration = deferred();
    const presence = createParticipantPresence(database, 'ROOM_A', 'Guest', vi.fn());
    onDisconnect.mockImplementationOnce((target) => ({ target, remove: () => registration.promise, cancel: vi.fn().mockResolvedValue() }));
    const pending = subscriptions[0].next(snapshot(true));
    const leaving = presence.leave();
    registration.resolve();
    await Promise.all([pending, leaving]);
    expect(set).not.toHaveBeenCalled();
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
  });

  it('removes a stale late write instead of resurrecting a departed participant', async () => {
    const write = deferred();
    set.mockReturnValueOnce(write.promise);
    const presence = createParticipantPresence(database, 'ROOM_A', 'Guest', vi.fn());
    const pending = subscriptions[0].next(snapshot(true));
    await Promise.resolve();
    const leaving = presence.leave();
    write.resolve();
    await Promise.all([pending, leaving]);
    expect(remove).toHaveBeenCalledWith({ path: '/rooms/ROOM_A/participants/Guest/connections/connection_1' });
  });

  it('fails closed when disconnect registration fails, and reports a generic error', async () => {
    onDisconnect.mockImplementationOnce(() => ({ remove: vi.fn().mockRejectedValue(new Error('sensitive provider details')), cancel: vi.fn().mockResolvedValue() }));
    const status = vi.fn();
    const presence = createParticipantPresence(database, 'ROOM_A', 'Guest', status);
    await subscriptions[0].next(snapshot(true));
    expect(set).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith({ ready: false, error: 'Could not update your presence. Rejoin the room to try again.' });
    await presence.leave();
  });

  it('makes repeated leave calls idempotent and ignores disposed callbacks', async () => {
    const status = vi.fn();
    const presence = createParticipantPresence(database, 'ROOM_A', 'Guest', status);
    await subscriptions[0].next(snapshot(true));
    await Promise.all([presence.leave(), presence.leave()]);
    await subscriptions[0].next(snapshot(true));
    expect(set).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
  });
});
