import { describe, expect, it } from 'vitest';
import { getDubContext, getDubEpisodes, getDubSelection } from '../../src/anime/audioSources';

const animeId = 'ap_kidou-senshi-gundam-suisei-no-majo';
const title = 'Mobile Suit Gundam: The Witch from Mercury';

describe('verified official anime Dub selections', () => {
  it.each([[1, 'cq8zYG_hivI'], [2, 'bRqqvwxlPFA']])('maps episode %i to its verified English upload with a fresh playback clock', (episode, id) => {
    expect(getDubSelection(animeId, episode)).toEqual({ source: 'youtube', id, title: `${title} · Episode ${episode} · English dub`, position: 0 });
  });

  it.each([['ap_naruto', 1], [`${animeId}-unknown`, 1], [animeId, 13], [animeId, 0], [animeId, '1'], [animeId, 1.5], [null, 1], [animeId, NaN]])('does not invent a Dub for %s episode %s', (id, episode) => {
    expect(getDubSelection(id, episode)).toBeNull();
  });

  it('keeps the identifying episode/audio suffix while bounding a custom title to 120 characters', () => {
    const selection = getDubSelection(animeId, 2, 'A'.repeat(200));
    expect(selection.title.length).toBeLessThanOrEqual(120);
    expect(selection.title.endsWith(' · Episode 2 · English dub')).toBe(true);
    expect(getDubSelection(animeId, 1, '  Custom title  ').title).toBe('Custom title · Episode 1 · English dub');
    for (const value of ['', '   ', null, {}, undefined]) expect(getDubSelection(animeId, 1, value).title).toBe(`${title} · Episode 1 · English dub`);
  });

  it.each(['🎬'.repeat(100), `A${'🎬'.repeat(100)}`])('does not split a Unicode character at the title limit', name => {
    const selection = getDubSelection(animeId, 1, name);
    expect(selection.title.length).toBeLessThanOrEqual(120);
    expect(() => encodeURIComponent(selection.title)).not.toThrow();
  });

  it.each([['cq8zYG_hivI', 1], ['bRqqvwxlPFA', 2]])('returns canonical anime context for %s', (id, episode) => {
    expect(getDubContext(id)).toEqual({ animeId, episode, title });
  });

  it.each(['2B_njMCRCvU', 'https://www.youtube.com/watch?v=cq8zYG_hivI', '', null, 1])('rejects an unmapped reverse identifier %s', id => {
    expect(getDubContext(id)).toBeNull();
  });

  it('returns detached episode lists and selections without mutable registry exposure', () => {
    const episodes = getDubEpisodes(animeId);
    expect(episodes).toEqual(Array.from({ length: 12 }, (_, i) => i + 1)); episodes.push(99); episodes[0] = 42;
    expect(getDubEpisodes(animeId)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(getDubEpisodes('ap_naruto')).toEqual([]);
    const selection = getDubSelection(animeId, 1), context = getDubContext('cq8zYG_hivI');
    selection.id = 'changed'; selection.position = 50; context.animeId = 'ap_other'; context.episode = 99;
    expect(getDubSelection(animeId, 1)).toMatchObject({ id: 'cq8zYG_hivI', position: 0 });
    expect(getDubContext('cq8zYG_hivI')).toEqual({ animeId, episode: 1, title });
  });
});
