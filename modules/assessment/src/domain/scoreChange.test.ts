import { describe, expect, it } from 'vitest';
import { assess, type EvidenceLink, type RubricInput } from './assess.ts';
import { previewRatings, strengthOf, withInterviewChanges, type InterviewChange, type Rating } from './scoreChange.ts';

// Daniel Novak (synthetic): backed score 55, "Retrieval and evaluation" Supporting on a CV claim. The numbers follow
// the formula, not the scorecard artboard's illustrative ones (owner decision, 20 Nov 2026).
const RUBRIC: RubricInput = {
  versionId: 'rubric-v2',
  competencies: [
    { id: 'c-python', weightPercent: 55, levelNeeded: 4, type: 'mandatory' },
    { id: 'c-retrieval', weightPercent: 20, levelNeeded: 3, type: 'mandatory' },
    { id: 'c-cost', weightPercent: 25, levelNeeded: 3, type: 'desirable' },
  ],
};
const LINKS: EvidenceLink[] = [
  { itemId: 'i-repo', competencyId: 'c-python', level: 5, strength: 'strong', provenance: 'corroborated' },
  { itemId: 'i-cv', competencyId: 'c-retrieval', level: 4, strength: 'supporting', provenance: 'claim' },
];
const INTERVIEW = 'interview-1';

const preview = (competencyId: string, rating: Rating, links = LINKS, stored: InterviewChange[] = []) =>
  previewRatings(RUBRIC, links, stored, [{ competencyId, rating }], INTERVIEW);

describe('Scenario: Preview shows the strength and backed score before and after', () => {
  it('starts from a backed score of 55 with Retrieval at Supporting', () => {
    expect(assess(RUBRIC, LINKS).backedScore).toBe(55);
    expect(strengthOf(LINKS, 'c-retrieval')).toBe('supporting');
  });

  it.each([
    ['clearly_shown', 'medium', 71],
    ['strongly_shown', 'strong', 71],
  ] as const)('%s: Supporting to %s, cited to the interview, backed score 55 to %i', (rating, strength, backed) => {
    const { before, after, changes } = preview('c-retrieval', rating);
    expect([before.backedScore, after.backedScore]).toEqual([55, backed]);
    expect(changes.map((c) => [c.from, c.to])).toEqual([
      [
        { strength: 'supporting', provenLevel: 0 },
        { strength, provenLevel: 4 },
      ],
    ]);
    expect(after.competencies[1]?.proven.itemIds).toEqual([INTERVIEW]);
  });

  it('partly_shown changes nothing', () => {
    const { before, after, changes } = preview('c-retrieval', 'partly_shown');
    expect(after).toEqual(before);
    expect(changes).toEqual([]);
  });

  it('not_shown weakens evidence that counted to Claim only: backed score 55 to 0, the claim range kept', () => {
    const { before, after, changes } = preview('c-python', 'not_shown');
    expect([before.backedScore, after.backedScore, after.upperBound]).toEqual([55, 0, before.upperBound]);
    expect(changes.map((c) => [c.from, c.to, c.change.itemIds])).toEqual([
      [{ strength: 'strong', provenLevel: 5 }, { strength: 'claim', provenLevel: 0 }, ['i-repo']],
    ]);
  });

  it('a gap the interview shows is backed at the level the job needs', () => {
    const { after, changes } = preview('c-cost', 'clearly_shown');
    expect(changes[0]?.to).toEqual({ strength: 'medium', provenLevel: 3 });
    expect(after.backedScore).toBe(70);
  });

  it('a rating that moves nothing is left out: shown where stronger work already proves the level, not shown on a gap', () => {
    expect(preview('c-python', 'clearly_shown').changes).toEqual([]);
    expect(preview('c-cost', 'not_shown').changes).toEqual([]);
  });

  it('refuses a competency outside the rubric', () => {
    expect(() => preview('c-elsewhere', 'clearly_shown')).toThrow(RangeError);
  });
});

describe("Scenario: The interviewer's word is not verification", () => {
  // SAFETY: mutation check: withInterviewChanges also marked the competency's other links 'corroborated' -> this test failed (the CV claim was cited as proven)
  it('the interview counts as its own Candidate-submitted source and corroborates nothing else', () => {
    const { after, changes } = preview('c-retrieval', 'strongly_shown');
    const links = withInterviewChanges(
      LINKS,
      changes.map((c) => c.change),
    );
    expect(links.at(-1)).toEqual({
      itemId: INTERVIEW,
      competencyId: 'c-retrieval',
      level: 4,
      strength: 'strong',
      provenance: 'submitted',
    });
    expect(links.filter((l) => l.provenance === 'corroborated').map((l) => l.itemId)).toEqual(['i-repo']);
    // The CV claim is still a claim beside it: cited as a claim, never as proven.
    expect(after.competencies[1]).toMatchObject({
      proven: { level: 4, itemIds: [INTERVIEW] },
      claimItemIds: ['i-cv'],
    });
  });

  // SAFETY: mutation check: counts() let a claim-strength link count -> this test failed (backed score 55, not 0)
  it('a claim with nothing to inspect still counts zero after an interview weakened it', () => {
    const weakened = preview('c-python', 'not_shown').after;
    expect(weakened.competencies[0]?.proven).toEqual({ level: 0, itemIds: [] });
    expect(weakened.backedScore).toBe(0);
  });
});

describe('Stored changes stand in later assessments', () => {
  const weakened = preview('c-python', 'not_shown').changes.map((c) => c.change);

  it('evidence added after the interview is not weakened by it', () => {
    const later: EvidenceLink[] = [
      ...LINKS,
      { itemId: 'i-new', competencyId: 'c-python', level: 4, strength: 'medium', provenance: 'submitted' },
    ];
    expect(assess(RUBRIC, withInterviewChanges(later, weakened)).competencies[0]?.proven).toEqual({
      level: 4,
      itemIds: ['i-new'],
    });
  });

  it('the latest change to a competency stands', () => {
    const { after, changes } = previewRatings(
      RUBRIC,
      LINKS,
      weakened,
      [{ competencyId: 'c-python', rating: 'clearly_shown' }],
      'interview-2',
    );
    expect(changes[0]?.from).toEqual({ strength: 'claim', provenLevel: 0 });
    expect(after.competencies[0]?.proven).toEqual({ level: 5, itemIds: ['i-repo', 'interview-2'] });
  });

  it('is deterministic: the same input gives the same result', () => {
    expect(preview('c-retrieval', 'clearly_shown')).toEqual(preview('c-retrieval', 'clearly_shown'));
  });
});
