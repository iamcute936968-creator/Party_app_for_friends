import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Room from '../../src/components/Room';
import { useMediaLoad } from '../../src/hooks/useMediaLoad';

afterEach(cleanup);
function MediaRoom({ operation, authorize = async () => undefined, sharing = false, drive = false }) {
  const media = useMediaLoad('ROOM_A');
  const [url, setUrl] = useState('https://youtu.be/abcdefghijk');
  return <Room room={{ id: 'ROOM_A', host: 'Host', roomName: 'Movie night', isSharing: sharing }} isHost
    participants={[]} messages={[]} floatMsgs={[]} vidSrc={drive ? 'drive' : 'youtube'} msgInput="" ytUrl={url} setYtUrl={setUrl}
    vidRef={{ current: null }} driveVideoRef={{ current: null }} containerRef={{ current: null }}
    load={() => media.run('load', operation)} onAuthorize={() => media.run('authorize', authorize)}
    mediaAction={media.action} mediaError={media.error} mediaLoaded={media.loaded} />;
}

it('disables media editing and conflicting actions until the room write is acknowledged', async () => {
  let finish;
  const operation = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  render(<MediaRoom operation={operation} drive />);
  fireEvent.click(screen.getByRole('button', { name: 'Load video' }));
  expect(screen.getByRole('button', { name: 'Loading...' }).disabled).toBe(true);
  expect(screen.getByLabelText('Video URL').disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Authorize' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Share screen' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Leave room' }).disabled).toBe(false);
  fireEvent.submit(screen.getByRole('form', { name: 'Load a video' }));
  expect(operation).toHaveBeenCalledOnce();
  expect(screen.queryByText('Video added to the room.')).toBeNull();
  await act(async () => finish());
  expect(screen.getByRole('status', { name: 'Media feedback' }).textContent).toBe('Video added to the room.');
});

it('preserves the link, focuses inline errors and supports Enter to retry', async () => {
  const operation = vi.fn().mockRejectedValueOnce(new Error('private media detail')).mockResolvedValueOnce(undefined);
  render(<MediaRoom operation={operation} />);
  await act(async () => fireEvent.submit(screen.getByRole('form', { name: 'Load a video' })));
  const error = screen.getByRole('alert');
  expect(error.textContent).toBe('Could not add the video to the room. Try again.');
  expect(document.activeElement).toBe(error);
  const input = screen.getByLabelText('Video URL');
  expect(input.value).toBe('https://youtu.be/abcdefghijk');
  expect(input.getAttribute('aria-describedby')).toBe(error.id);
  expect(screen.getByRole('button', { name: 'Retry loading video' }).disabled).toBe(false);
  await act(async () => fireEvent.submit(screen.getByRole('form', { name: 'Load a video' })));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(operation).toHaveBeenCalledTimes(2);
});

it('handles an authorization rejection and allows another user-initiated attempt', async () => {
  let reject;
  const authorize = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValueOnce(undefined);
  render(<MediaRoom operation={vi.fn()} authorize={authorize} drive />);
  fireEvent.click(screen.getByRole('button', { name: 'Authorize' }));
  expect(authorize).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Authorizing...' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Load video' }).disabled).toBe(true);
  await act(async () => reject(new Error('private OAuth response')));
  expect(screen.getByRole('alert').textContent).toBe('Could not authorize Google Drive. Try again.');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Authorize' })));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText('Video added to the room.')).toBeNull();
  expect(authorize).toHaveBeenCalledTimes(2);
});

it('prevents form submissions while screen sharing', async () => {
  const operation = vi.fn();
  render(<MediaRoom operation={operation} sharing />);
  expect(screen.getByLabelText('Video URL').disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Load video' }).disabled).toBe(true);
  await act(async () => fireEvent.submit(screen.getByRole('form', { name: 'Load a video' })));
  expect(operation).not.toHaveBeenCalled();
});

it('renders validation feedback as text and associates it with the input', async () => {
  render(<MediaRoom operation={async () => 'Enter a valid YouTube or Google Drive link.'} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load video' })));
  expect(screen.getByRole('alert').textContent).toBe('Enter a valid YouTube or Google Drive link.');
  expect(screen.queryByText('Video added to the room.')).toBeNull();
});
