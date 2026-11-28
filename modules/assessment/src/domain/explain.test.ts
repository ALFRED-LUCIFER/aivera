import { describe, expect, it } from 'vitest';
import { assess, type EvidenceLink } from './assess.ts';
import { citedLead } from './explain.ts';

// AIV-P1-165 §9: what a ranking row's one-line reason cites, from the snapshot alone.
const RUBRIC = {
  versionId: 'rubric-v1',
  competencies: [
    { id: 'c-llm', weightPercent: 40, levelNeeded: 4, type: 'mandatory' as const },
    { id: 'c-eval', weightPercent: 35, levelNeeded: 3, type: 'mandatory' as const },
    { id: 'c-arabic', weightPercent: 25, levelNeeded: 2, type: 'mandatory' as const },
  ],
};
const link = (
  itemId: string,
  competencyId: string,
  level: number,
  provenance: EvidenceLink['provenance'],
  strength: EvidenceLink['strength'] = 'strong',
): EvidenceLink => ({ itemId, competencyId, level, strength, provenance });

describe('citedLead', () => {
  it('cites the work behind the competency that adds most to the backed score', () => {
    const snapshot = assess(RUBRIC, [
      link('repo-llm', 'c-llm', 2, 'corroborated'),
      link('repo-eval', 'c-eval', 4, 'submitted'),
      link('cv-arabic', 'c-arabic', 5, 'claim', 'supporting'),
    ]);
    // 35 x 4 outweighs 40 x 2; the claim, whatever its level, is never the lead while work is proven.
    expect(citedLead(snapshot)).toEqual({ competencyId: 'c-eval', itemId: 'repo-eval', level: 4, claim: false });
  });

  // SAFETY: mutation check: `claim: true` written as `claim: false` in citedLead -> this test failed.
  it('labels the line a claim when nothing is proven: a claim counts zero and is never cited as backing', () => {
    const snapshot = assess(RUBRIC, [
      link('cv-llm', 'c-llm', 3, 'claim', 'supporting'),
      link('cv-eval', 'c-eval', 4, 'claim', 'supporting'),
    ]);
    expect(snapshot.backedScore).toBe(0);
    expect(citedLead(snapshot)).toEqual({ competencyId: 'c-eval', itemId: 'cv-eval', level: 4, claim: true });
  });

  // SAFETY: mutation check: `assess` sorting cited items by id only again -> this test failed (it cited the level-2 commit).
  it('cites the item that sets the proven level, not the first by id', () => {
    const snapshot = assess(RUBRIC, [
      link('a-commit', 'c-eval', 2, 'submitted'),
      link('z-repo', 'c-eval', 4, 'submitted'),
    ]);
    expect(citedLead(snapshot)).toEqual({ competencyId: 'c-eval', itemId: 'z-repo', level: 4, claim: false });
    const claims = assess(RUBRIC, [
      link('a-cv', 'c-eval', 2, 'claim', 'supporting'),
      link('z-cv', 'c-eval', 4, 'claim', 'supporting'),
    ]);
    expect(citedLead(claims)).toEqual({ competencyId: 'c-eval', itemId: 'z-cv', level: 4, claim: true });
  });

  it('cites nothing when the snapshot cites nothing', () => {
    expect(citedLead(assess(RUBRIC, []))).toBeNull();
  });
});
