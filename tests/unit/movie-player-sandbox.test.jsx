import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MoviePlayer from '../../src/components/MoviePlayer';
import Room from '../../src/components/Room';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Movie player iframe sandbox security and cast prevention', () => {
  it('omits allow-presentation from sandbox in MoviePlayer to prevent Google Cast collision with title', () => {
    render(<MoviePlayer item={{ id: '791523', title: 'Wildwood' }} selection={{ kind: 'movie', id: '791523' }} />);
    const iframe = screen.getByTitle('Wildwood player');
    expect(iframe).toBeTruthy();
    const sandbox = iframe.getAttribute('sandbox') || '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-presentation');
  });

  it('omits allow-presentation from sandbox in Room to prevent Google Cast collision with title', () => {
    const room = { id: 'ROOM', videoSource: 'movie', videoId: '791523', movieKind: 'movie', movieTitle: 'Wildwood', movieSeason: 0, movieEpisode: 0, mediaSelectionId: 'first', playbackState: 'PAUSED' };
    const props = { room, videoId: '791523', vidSrc: 'movie', participants: [], messages: [], msgInput: '', ytUrl: '', vidRef: { current: null }, driveVideoRef: { current: null }, movieFrameRef: { current: null }, containerRef: { current: null } };
    render(<Room {...props} isHost moviePlayerGeneration={0} />);
    const iframe = screen.getByTitle('Room movie player');
    expect(iframe).toBeTruthy();
    const sandbox = iframe.getAttribute('sandbox') || '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-presentation');
  });
});

