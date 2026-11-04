import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Room from '../../src/components/Room';
import { useMediaLoad } from '../../src/hooks/useMediaLoad';
import { useDriveStream } from '../../src/hooks/useDriveStream';
import { useDriveVideo } from '../../src/hooks/useDriveVideo';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const failedTicket = { ok: false, status: 503, json: async () => ({ error: 'Video preparation failed. Try again.' }) };
const ticket = { ok: true, json: async () => ({ mediaUrl: '/media/movie?t=fixture-ticket' }) };
function DriveRoom({ streaming = true, authorized = true, ready = true, authorize = vi.fn(), roomId = 'ROOM_A' }) {
  const stream = useDriveStream({ proxyUrl: 'https://proxy.example' });
  const blob = useDriveVideo();
  const media = useMediaLoad(roomId);
  const { loadDriveStream, revokeStream } = stream;
  const { loadDriveVideo, revokeBlobUrl } = blob;
  useEffect(() => {
    if (streaming) void loadDriveStream('movie', { roomId, roomSecret: 'fixture-secret', username: 'Guest' });
    else void loadDriveVideo('movie', 'fixture-access-token');
    return streaming ? revokeStream : revokeBlobUrl;
  }, [roomId, streaming, loadDriveStream, revokeStream, loadDriveVideo, revokeBlobUrl]);
  const resource = streaming ? stream : blob;
  const retry = () => {
    if (!ready || resource.loading || (!streaming && !authorized)) return;
    return media.run('retry', () => streaming ?
      loadDriveStream('movie', { roomId, roomSecret: 'fixture-secret', username: 'Guest' }) :
      loadDriveVideo('movie', 'fixture-access-token'));
  };
  return <Room room={{ id: roomId, host: 'Host', roomName: 'Movie night' }}
    participants={[]} messages={[]} floatMsgs={[]} videoId="movie" vidSrc="drive" msgInput="" ytUrl=""
    vidRef={{ current: null }} driveVideoRef={{ current: null }} containerRef={{ current: null }}
    driveLoading={resource.loading} driveError={resource.error} driveProgress={blob.progress}
    driveMetadata={resource.metadata} isStreaming={streaming} isAuthorized={authorized}
    onAuthorize={authorize} retryDrive={retry} canRetryDrive={ready}
    mediaAction={media.action} mediaError={media.error} mediaLoaded={media.loaded} />;
}

it('retries a failed stream, prevents duplicate requests and reports preparation until completion', async () => {
  let finish;
  const fetch = vi.fn().mockResolvedValueOnce(failedTicket).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal('fetch', fetch);
  await act(async () => render(<DriveRoom />));
  const retry = screen.getByRole('button', { name: 'Retry video' });
  fireEvent.click(retry);
  fireEvent.click(retry);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status', { name: 'Video preparation' }).textContent).toContain('Preparing stream');
  expect(screen.getByLabelText('Video URL').disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Share screen' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Leave room' }).disabled).toBe(false);
  await act(async () => finish(ticket));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('status', { name: 'Video preparation' })).toBeNull();
  expect(screen.getByLabelText('Video URL').disabled).toBe(false);
  expect(screen.queryByText('Video added to the room.')).toBeNull();
});

it('allows a later deliberate retry when stream preparation fails again', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(failedTicket).mockResolvedValueOnce(failedTicket).mockResolvedValueOnce(ticket);
  vi.stubGlobal('fetch', fetch);
  await act(async () => render(<DriveRoom />));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry video' })));
  expect(screen.getByRole('alert').textContent).toContain('Video preparation failed. Try again.');
  expect(screen.getByRole('button', { name: 'Retry video' }).disabled).toBe(false);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry video' })));
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('retries a failed download through the real metadata and blob hooks', async () => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:fixture-video');
    static revokeObjectURL = vi.fn();
  });
  const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'Movie', mimeType: 'video/mp4', size: '3' }) })
    .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-length': '3' }), body: {
      getReader: () => ({ read: vi.fn().mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) }).mockResolvedValue({ done: true }) }),
    } });
  vi.stubGlobal('fetch', fetch);
  await act(async () => render(<DriveRoom streaming={false} />));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry video' })));
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
});

it('keeps retry disabled while room access is unavailable and restores it when ready', async () => {
  const fetch = vi.fn().mockResolvedValue(failedTicket);
  vi.stubGlobal('fetch', fetch);
  let rerender;
  await act(async () => { ({ rerender } = render(<DriveRoom ready={false} />)); });
  const retry = screen.getByRole('button', { name: 'Retry video' });
  expect(retry.disabled).toBe(true);
  fireEvent.click(retry);
  expect(fetch).toHaveBeenCalledOnce();
  rerender(<DriveRoom ready />);
  expect(screen.getByRole('button', { name: 'Retry video' }).disabled).toBe(false);
});

it('offers authorization instead of retrying a download without OAuth access', async () => {
  const authorize = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
  await act(async () => render(<DriveRoom streaming={false} authorized={false} authorize={authorize} />));
  expect(screen.queryByRole('button', { name: 'Retry video' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Authorize' }));
  expect(authorize).toHaveBeenCalledOnce();
});

it('aborts retry work and isolates late failures when the room changes', async () => {
  let finish;
  const fetch = vi.fn().mockResolvedValueOnce(failedTicket)
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(ticket);
  vi.stubGlobal('fetch', fetch);
  let rerender;
  await act(async () => { ({ rerender } = render(<DriveRoom />)); });
  fireEvent.click(screen.getByRole('button', { name: 'Retry video' }));
  await act(async () => rerender(<DriveRoom roomId="ROOM_B" />));
  expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
  await act(async () => finish(failedTicket));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('status', { name: 'Media feedback' })).toBeNull();
  expect(screen.getByLabelText('Video URL').disabled).toBe(false);
});

it('renders provider failure content as plain text while retaining the retry control', async () => {
  const content = '<img src=x onerror="window.providerInjected=true">';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: content }) }));
  await act(async () => render(<DriveRoom />));
  expect(screen.getByRole('alert').textContent).toContain(content);
  expect(screen.getByRole('alert').querySelector('img')).toBeNull();
  expect(window.providerInjected).toBeUndefined();
  expect(screen.getByRole('button', { name: 'Retry video' }).disabled).toBe(false);
});
