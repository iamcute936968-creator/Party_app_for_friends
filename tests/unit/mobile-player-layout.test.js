import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

describe('mobile movie player styles', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/components/MoviesPage.css'), 'utf-8');

  it('allocates sufficient height on mobile so playback controls do not collide', () => {
    // In max-width: 600px media query, movie-player-frame needs at least 340px height
    // because CineSrc mobile controls require 56px timebar + 76px controlbar + 78px centered controls
    expect(css).toMatch(/\.movie-player-frame\s*\{[^}]*min-height:\s*(?:3[4-9]\d|4\d\d)px/);
  });

  it('does not apply overflowing negative margins on mobile screens', () => {
    // Negative margins on mobile caused horizontal overflow and clipped player controls
    const media600Block = css.slice(css.indexOf('@media (max-width: 600px)'));
    const media480Block = css.slice(css.indexOf('@media (max-width: 480px)'));
    
    expect(media600Block).not.toMatch(/\.movie-player\s*\{[^}]*margin-left:\s*-\d+px/);
    expect(media480Block).not.toMatch(/\.movie-player\s*\{[^}]*margin-left:\s*-\d+px/);
  });

  it('preserves clean border and rounded corners for the player card on mobile', () => {
    const media600Block = css.slice(css.indexOf('@media (max-width: 600px)'));
    expect(media600Block).not.toMatch(/\.movie-player-frame\s*\{[^}]*border-radius:\s*0/);
  });

  it('allocates space below movie-watch-heading so facts and watch together button have a gap', () => {
    expect(css).toMatch(/\.movie-watch-heading\s*\{[^}]*margin-bottom:\s*(?:1[2-9]|2\d)px/);
  });
});
