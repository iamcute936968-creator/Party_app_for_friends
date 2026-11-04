import React, { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, push, set, remove, get, onValue, onDisconnect } from '../helpers/firebase-database';
import { useParticipantPresence } from '../../src/hooks/useParticipantPresence';
import { getOnlineParticipants } from '../../src/presence/participantPresence';

const database = {};
let store;
let listeners;
let handlers;
let sequence;
const snapshot = (value) => ({ val: () => structuredClone(value) });
const participants = (room = 'ROOM_A') => {
  const output = {};
  for (const [path, value] of store) {
    const match = path.match(new RegExp(`^/rooms/${room}/participants/([^/]+)/connections/([^/]+)$`));
    if (match) (output[match[1]] ??= { connections: {} }).connections[match[2]] = value;
  }
  return output;
};
const connect = async (online) => act(async () => {
  if (!online) {
    for (const path of handlers) store.delete(path);
    handlers.clear();
  }
  await Promise.all([...listeners].map((listener) => listener.next(snapshot(online))));
});
function Tab({ id, room = 'ROOM_A', name = 'Guest' }) {
  const presence = useParticipantPresence(database, room, name);
  return <output data-testid={id}>{presence.error || (presence.ready ? 'Ready' : 'Waiting')}</output>;
}

beforeEach(() => {
  store = new Map(); listeners = new Set(); handlers = new Set(); sequence = 0;
  ref.mockImplementation((_db, path) => ({ path }));
  push.mockImplementation((parent) => ({ path: `${parent.path}/connection_${++sequence}` }));
  set.mockImplementation(async (target, value) => { store.set(target.path, value); });
  remove.mockImplementation(async (target) => { store.delete(target.path); });
  get.mockImplementation(async (target) => {
    const match = target.path.match(/^\/rooms\/([^/]+)\/participants\/([^/]+)$/);
    return snapshot(match ? participants(match[1])[match[2]] ?? null : null);
  });
  onValue.mockImplementation((_target, next, error) => {
    const listener = { next, error }; listeners.add(listener);
    return () => listeners.delete(listener);
  });
  onDisconnect.mockImplementation((target) => ({
    remove: async () => { handlers.add(target.path); },
    cancel: async () => { handlers.delete(target.path); },
  }));
});
afterEach(cleanup);

describe('presence hook with shared connection storage', () => {
  it('keeps a participant online when one of two tabs unmounts, then removes the final connection', async () => {
    const first = render(<Tab id="first" />);
    const second = render(<Tab id="second" />);
    await connect(true);
    expect(screen.getByTestId('first').textContent).toBe('Ready');
    expect(store.size).toBe(2);
    first.unmount();
    await waitFor(() => expect(store.size).toBe(1));
    expect(getOnlineParticipants(participants())).toEqual(['Guest']);
    expect(screen.getByTestId('second').textContent).toBe('Ready');
    second.unmount();
    await waitFor(() => expect(store.size).toBe(0));
    expect(getOnlineParticipants(participants())).toEqual([]);
  });

  it('recovers with a new connection after server disconnect cleanup without writing playback state', async () => {
    render(<Tab id="tab" />);
    await connect(true);
    const original = [...store.keys()][0];
    await connect(false);
    expect(store.size).toBe(0);
    expect(screen.getByTestId('tab').textContent).toBe('Waiting');
    await connect(true);
    expect(store.size).toBe(1);
    expect([...store.keys()][0]).not.toBe(original);
    expect(screen.getByTestId('tab').textContent).toBe('Ready');
    expect([...store.keys()].every((path) => path.includes('/participants/Guest/connections/'))).toBe(true);
    expect(set.mock.calls.every(([target]) => target.path.includes('/participants/'))).toBe(true);
  });

  it('cleans up StrictMode and room changes, including stale callbacks', async () => {
    const view = render(<StrictMode><Tab id="tab" /></StrictMode>);
    expect(listeners.size).toBe(1);
    const stale = [...listeners][0];
    await connect(true);
    view.rerender(<StrictMode><Tab id="tab" room="ROOM_B" /></StrictMode>);
    expect(screen.getByTestId('tab').textContent).toBe('Waiting');
    await act(async () => stale.next(snapshot(true)));
    await connect(true);
    await waitFor(() => expect(getOnlineParticipants(participants())).toEqual([]));
    expect(getOnlineParticipants(participants('ROOM_B'))).toEqual(['Guest']);
    expect(listeners.size).toBe(1);
    view.unmount();
    await waitFor(() => expect(store.size).toBe(0));
    expect(listeners.size).toBe(0);
    expect(handlers.size).toBe(0);
  });

  it('surfaces a generic presence failure independently of transport status', async () => {
    onDisconnect.mockImplementationOnce(() => ({ remove: async () => { throw new Error('private provider detail'); }, cancel: vi.fn() }));
    render(<Tab id="tab" />);
    await connect(true);
    expect(screen.getByTestId('tab').textContent).toBe('Could not update your presence. Rejoin the room to try again.');
    expect(store.size).toBe(0);
  });
});
