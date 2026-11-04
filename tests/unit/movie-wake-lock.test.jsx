import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MoviePlayer from '../../src/components/MoviePlayer';
import Room from '../../src/components/Room';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Movie player iframe screen-wake-lock permission', () => {
  it('includes screen-wake-lock in allow attribute for MoviePlayer solo watch iframe', () => {
    render(<MoviePlayer item={{ id: '791523', title: 'Wildwood' }} selection={{ kind: 'movie', id: '791523' }} />);
    const iframe = screen.getByTitle('Wildwood player');
    expect(iframe).toBeTruthy();
    const allowAttr = iframe.getAttribute('allow') || '';
    expect(allowAttr).toContain('screen-wake-lock');
  });

  it('includes screen-wake-lock in allow attribute for Room shared movie player iframe', () => {
    const room = { id: 'ROOM', videoSource: 'movie', videoId: '791523', movieKind: 'movie', movieTitle: 'Wildwood', movieSeason: 0, movieEpisode: 0, mediaSelectionId: 'first', playbackState: 'PAUSED' };
    const props = { room, videoId: '791523', vidSrc: 'movie', participants: [], messages: [], msgInput: '', ytUrl: '', vidRef: { current: null }, driveVideoRef: { current: null }, movieFrameRef: { current: null }, containerRef: { current: null } };
    render(<Room {...props} isHost moviePlayerGeneration={0} />);
    const iframe = screen.getByTitle('Room movie player');
    expect(iframe).toBeTruthy();
    const allowAttr = iframe.getAttribute('allow') || '';
    expect(allowAttr).toContain('screen-wake-lock');
  });
});

