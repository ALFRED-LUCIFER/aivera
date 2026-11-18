import { describe, expect, it } from 'vitest';
import { citeExact, playsIntro } from './hero.ts';

describe('the hero evidence card', () => {
  it('cites the exact words, and nothing when they are missing', () => {
    const text = 'In the repository she wrote 148 of 171 test cases. More.';
    const [c] = citeExact(text, 'wrote 148 of 171 test cases', 'repo');
    expect(text.slice(c?.start, c?.end)).toBe('wrote 148 of 171 test cases');
    expect(citeExact(text, 'wrote 150', 'repo')).toEqual([]);
  });

  // SAFETY: mutation check: dropped `!o.reducedMotion` -> this test failed
  it('Scenario: Reduced motion shows the final state: the intro never plays', () => {
    expect(playsIntro({ reducedMotion: true, onScreen: false, entranceOpacity: 1 })).toBe(false);
    expect(playsIntro({ reducedMotion: true, onScreen: true, entranceOpacity: 0 })).toBe(false);
  });

  it('plays while unseen (entering or below the fold), never over a card already showing 72', () => {
    expect(playsIntro({ reducedMotion: false, onScreen: true, entranceOpacity: 0.1 })).toBe(true);
    expect(playsIntro({ reducedMotion: false, onScreen: false, entranceOpacity: 1 })).toBe(true);
    expect(playsIntro({ reducedMotion: false, onScreen: true, entranceOpacity: 0.9 })).toBe(false);
  });
});
