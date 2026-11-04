import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Room from '../../src/components/Room';
import { useWebRTC } from '../../src/hooks/useWebRTC';
import { onValue, set, remove, runTransaction } from '../helpers/firebase-database';

const db = {};
const room = { id: 'ROOM_A', secret: 'fixture-secret', hostUid: 'Host', identities: { Host: 'Host', Guest: 'Guest' }, roomName: 'Movie night', host: 'Host', participants: { Host: true } };
let capture;
beforeEach(() => {
  vi.clearAllMocks();
  onValue.mockImplementation((target, next) => {
    const grant = /^\/roomAccess\/ROOM_A\/(Host|Guest)(\/name)?$/.exec(target.path);
    if (grant) next({ val: () => grant[2] ? grant[1] : { name: grant[1], secret: room.secret } });
    return () => {};
  }); set.mockResolvedValue(); remove.mockResolvedValue();
  runTransaction.mockImplementation(async (_target, fn) => ({ committed: Boolean(fn(room)) }));
  capture = vi.fn(); vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: capture } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function ShareRoom({ data = room, user = 'Host' }) {
  const share = useWebRTC(db, data.id, user, user === data.host, data);
  return <Room room={data} participants={[]} messages={[]} floatMsgs={[]} vidRef={share.vidRef}
    driveVideoRef={{ current: null }} containerRef={{ current: null }} ytUrl="" msgInput="" vidSrc="youtube"
    startShare={share.startShare} stopShare={share.stopShare} reconnectShare={share.reconnectShare}
    amSharing={share.amSharing} canStopShare={share.canStopShare} shareError={share.shareError} shareStatus={share.shareStatus} />;
}
it('announces pending capture, handles denied permission inline, and allows retry without a blocking alert', async () => {
  let reject;
  capture.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockRejectedValueOnce(new DOMException('private', 'NotAllowedError'));
  render(<ShareRoom />);
  fireEvent.click(screen.getByRole('button', { name: 'Share screen' }));
  expect(screen.getByRole('button', { name: 'Starting share...' }).disabled).toBe(true);
  expect(screen.getByRole('status', { name: 'Screen sharing status' }).textContent).toContain('Choose a screen');
  await act(async () => reject(new DOMException('private detail', 'NotAllowedError')));
  expect(screen.getByRole('alert').textContent).toContain('permission');
  expect(screen.getByRole('button', { name: 'Share screen' }).disabled).toBe(false);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share screen' })));
  expect(capture).toHaveBeenCalledTimes(2);
  expect(runTransaction).not.toHaveBeenCalled();
});
it('gives viewers a reconnect action without exposing the owner stop action', () => {
  render(<ShareRoom user="Guest" data={{ ...room, isSharing: true, shareHost: 'Host', shareSessionId: 'broadcast' }} />);
  expect(screen.queryByRole('button', { name: 'Stop sharing' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Reconnect screen share' })).toBeTruthy();
  expect(runTransaction).not.toHaveBeenCalled();
});
it('lets the authenticated legacy owner explicitly release a share after reload', async () => {
  render(<ShareRoom data={{ ...room, isSharing: true, shareHost: 'Host', shareSessionId: 'legacy', screenShare: { id: 'legacy', owner: 'Host', ownerUid: 'Host' } }} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' })));
  expect(runTransaction).toHaveBeenCalled();
});
it('reports unsupported capture as inline feedback', async () => {
  vi.stubGlobal('navigator', {});
  render(<ShareRoom />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share screen' })));
  expect(screen.getByRole('alert').textContent).toContain('not supported');
  expect(runTransaction).not.toHaveBeenCalled();
});
it('offers Android viewing guidance instead of an unsupported broadcast action', () => {
  render(<Room room={room} participants={[]} messages={[]} floatMsgs={[]} vidSrc="youtube" ytUrl="" msgInput=""
    vidRef={{ current: null }} driveVideoRef={{ current: null }} containerRef={{ current: null }} screenCaptureSupported={false} />);
  expect(screen.queryByRole('button', { name: 'Share screen', exact: true })).toBeNull();
  expect(screen.getByRole('status', { name: 'Screen sharing availability' }).textContent).toMatch(/watch.*desktop/i);
});
