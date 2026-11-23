import { describe, expect, it } from 'vitest';
import { mapsEvidence } from './mapping.ts';

// AIV-P2-062: the evidence queue has a consumer whenever any reader feeds it and a model can map.
describe('mapsEvidence', () => {
  // SAFETY: mutation check: restored `githubApp && model` (file reading alone never mapped) -> this test failed
  it.each([
    ['the GitHub App only', { model: true, githubApp: true, fileReading: false }, true],
    ['file reading only', { model: true, githubApp: false, fileReading: true }, true],
    ['both', { model: true, githubApp: true, fileReading: true }, true],
    ['no reader', { model: true, githubApp: false, fileReading: false }, false],
    ['no model', { model: false, githubApp: true, fileReading: true }, false],
  ])('with a model and %s', (_, readers, maps) => expect(mapsEvidence(readers)).toBe(maps));
});
