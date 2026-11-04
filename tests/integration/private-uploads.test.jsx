import React from 'react';
import { webcrypto } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import UploadsPanel from '../../src/components/UploadsPanel';
import Home from '../../src/components/Home';
import Room from '../../src/components/Room';
const auth = vi.hoisted(() => ({ ready: true, authorize: vi.fn(), clearToken: vi.fn(), error: '' }));
vi.mock('../../src/hooks/useDriveUploadAuth', () => ({ useDriveUploadAuth: () => auth }));
const config = { enabled: true, readerEmail: 'reader@watch-party.iam.gserviceaccount.com' };
const json = value => new Response(JSON.stringify(value), { status: 200 });
const props = () => ({ account: { user: { uid: 'owner123', email: 'owner@example.com', isAnonymous: false } },
  library: { items: [], toggle: vi.fn() }, proxyUrl: 'https://proxy.example', roomId: 'ROOM1', canChoose: true, onChoose: vi.fn() });
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); auth.authorize.mockResolvedValue('private-token'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });
const open = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Connect Google Drive' }));
  await screen.findByText('No uploaded videos yet.');
};
it('keeps guest uploads unavailable and never requests a Drive token', () => {
  render(<UploadsPanel {...props()} account={{ user: { uid: 'guest', isAnonymous: true } }} />);
  expect(screen.getByText(/Sign in with Google on the Account page/)).toBeTruthy();
  expect(auth.authorize).not.toHaveBeenCalled();
});
it('fails closed when backend upload sharing is disabled or has an invalid recipient', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ enabled: true, readerEmail: 'stranger@example.com' })));
  render(<UploadsPanel {...props()} />);
  await screen.findByText(/Uploads are unavailable/);
  expect(screen.queryByRole('button', { name: 'Connect Google Drive' })).toBeNull();
});
it('uploads privately, then explicitly grants reader access before adding to a room', async () => {
  const options = props();
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('owner123'))).toString('hex');
  const fetchFn = vi.fn().mockResolvedValueOnce(json(config)).mockResolvedValueOnce(json({ files: [] }))
    .mockResolvedValueOnce(json({ storageQuota: { usage: '0', limit: '1000000' } }))
    .mockResolvedValueOnce(new Response(null, { status: 200, headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=local' } }))
    .mockResolvedValueOnce(json({ id: 'newvideo', size: '4', mimeType: 'video/mp4' }))
    .mockResolvedValueOnce(json({ id: 'newvideo', ownedByMe: true, permissions: [], properties: { watchPartyVersion: '1', watchPartyOwnerHash: hash, watchPartyRoom: '' } }))
    .mockResolvedValueOnce(json({ id: 'newvideo' })).mockResolvedValueOnce(json({ id: 'reader-permission' }));
  vi.stubGlobal('fetch', fetchFn);
  render(<UploadsPanel {...options} />);
  await open();
  const file = { name: 'Our film.mp4', size: 4, type: 'video/mp4', slice: (start, end) => new Blob([new Uint8Array(end - start)]) };
  fireEvent.change(screen.getByLabelText('Video file'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload privately' }));
  await screen.findByText(/Uploaded to your private Google Drive/);
  expect(options.onChoose).not.toHaveBeenCalled();
  expect(fetchFn.mock.calls).toHaveLength(5);
  expect(JSON.parse(fetchFn.mock.calls[3][1].body).properties.watchPartyRoom).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Share Our film.mp4 with this room' }));
  await waitFor(() => expect(options.onChoose).toHaveBeenCalledWith({ source: 'drive', id: 'newvideo' }));
  expect(JSON.parse(fetchFn.mock.calls[6][1].body)).toEqual({ properties: { watchPartyRoom: 'ROOM1' } });
  expect(JSON.parse(fetchFn.mock.calls[7][1].body)).toEqual({ type: 'user', role: 'reader', emailAddress: config.readerEmail });
  expect(fetchFn.mock.calls[7][0]).toContain('sendNotificationEmail=false');
  expect(JSON.stringify(options.library.toggle.mock.calls)).not.toContain('private-token');
});
it('aborts a pending upload on unmount without loading it into a departed room', async () => {
  const options = props(); let signal;
  const fetchFn = vi.fn().mockResolvedValueOnce(json(config)).mockResolvedValueOnce(json({ files: [] }))
    .mockImplementationOnce((_url, init) => { signal = init.signal; return new Promise(() => {}); });
  vi.stubGlobal('fetch', fetchFn);
  const view = render(<UploadsPanel {...options} />); await open();
  fireEvent.change(screen.getByLabelText('Video file'), { target: { files: [{ size: 1, type: 'video/mp4', name: 'film.mp4', slice() {} }] } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload privately' }));
  await waitFor(() => expect(signal).toBeDefined());
  view.unmount(); expect(signal.aborted).toBe(true); expect(options.onChoose).not.toHaveBeenCalled();
});
it('can cancel a stalled first connection before the upload list has opened', async () => {
  let signal;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(config))
    .mockImplementationOnce((_url, init) => { signal = init.signal; return new Promise(() => {}); }));
  render(<UploadsPanel {...props()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Connect Google Drive' }));
  await waitFor(() => expect(signal).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole('button', { name: 'Connect Google Drive' }).disabled).toBe(false);
});
it('places private uploads on Library and keeps room creation uncluttered', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  render(<Home account={{ user: null }} library={{ items: [], persistent: true }} />);
  expect(screen.queryByRole('region', { name: 'Private video uploads' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Library', exact: true }));
  expect(screen.getByRole('region', { name: 'Private video uploads' })).toBeTruthy();
});
it('shows the signed-in room member the explicit sharing controls', async () => {
  const options = props();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(config)).mockResolvedValueOnce(json({ files: [] })));
  render(<Room account={options.account} room={{ id: 'ROOM1' }} participants={[]} messages={[]} msgInput=""
    library={options.library} connectionStatus="connected" chooseLibrary={options.onChoose}
    containerRef={{ current: null }} vidRef={{ current: null }} driveVideoRef={{ current: null }} uploadProxyUrl={options.proxyUrl} />);
  expect(screen.queryByRole('region', { name: 'Private video uploads' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Browse media' }));
  fireEvent.click(screen.getByRole('button', { name: 'Library', exact: true }));
  await open();
  expect(screen.getByText(/Sharing grants the Watch Party playback service reader access/)).toBeTruthy();
});
