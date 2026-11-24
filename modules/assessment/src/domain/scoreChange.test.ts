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
const REPO: EvidenceLink = {
  itemId: 'i-repo',
  competencyId: 'c-python',
  level: 5,
  strength: 'strong',
  provenance: 'corroborated',
};
const cvClaim = (level: number): EvidenceLink => ({
  itemId: 'i-cv',
  competencyId: 'c-retrieval',
  level,
  strength: 'supporting',
  provenance: 'claim',
});
const LINKS: EvidenceLink[] = [REPO, cvClaim(4)];
// An incident review he submitted himself: Medium, Candidate-submitted, so it counts until an interview weakens it.
const DOC: EvidenceLink = {
  itemId: 'i-doc',
  competencyId: 'c-cost',
  level: 3,
  strength: 'medium',
  provenance: 'submitted',
};
const INTERVIEW = 'interview-1';

const preview = (
  competencyId: string,
  rating: Rating,
  links = LINKS,
  stored: InterviewChange[] = [],
  sourceId = INTERVIEW,
) => previewRatings(RUBRIC, links, stored, [{ competencyId, rating }], sourceId);

describe('Scenario: Preview shows the strength and backed score before and after', () => {
  it('starts from a backed score of 55 with Retrieval at Supporting', () => {
    expect(assess(RUBRIC, LINKS).backedScore).toBe(55);
    expect(strengthOf(LINKS, 'c-retrieval')).toBe('supporting');
  });

  it.each([
    ['clearly_shown', 'medium'],
    ['strongly_shown', 'strong'],
  ] as const)(
    '%s: Supporting to %s at the level the job needs, cited to the interview, 55 to 67',
    (rating, strength) => {
      const { before, after, changes } = preview('c-retrieval', rating);
      expect([before.backedScore, after.backedScore]).toEqual([55, 67]);
      expect(changes.map((c) => [c.from, c.to])).toEqual([
        [
          { strength: 'supporting', provenLevel: 0 },
          { strength, provenLevel: 3 },
        ],
      ]);
      expect(after.competencies[1]?.proven.itemIds).toEqual([INTERVIEW]);
    },
  );

  it('partly_shown changes nothing', () => {
    const { before, after, changes } = preview('c-retrieval', 'partly_shown');
    expect(after).toEqual(before);
    expect(changes).toEqual([]);
  });

  it('not_shown weakens submitted work that counted to Claim only: backed score 70 to 55, the claim range kept', () => {
    const { before, after, changes } = preview('c-cost', 'not_shown', [...LINKS, DOC]);
    expect([before.backedScore, after.backedScore, after.upperBound]).toEqual([70, 55, before.upperBound]);
    expect(changes.map((c) => [c.from, c.to, c.change.itemIds])).toEqual([
      [{ strength: 'medium', provenLevel: 3 }, { strength: 'claim', provenLevel: 0 }, ['i-doc']],
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
  it('the interview counts as its own source, scored like submitted work, and corroborates nothing else', () => {
    const { after, changes } = preview('c-retrieval', 'strongly_shown');
    const links = withInterviewChanges(
      LINKS,
      changes.map((c) => c.change),
    );
    expect(links.at(-1)).toEqual({
      itemId: INTERVIEW,
      competencyId: 'c-retrieval',
      level: 3,
      strength: 'strong',
      provenance: 'submitted',
    });
    expect(links.filter((l) => l.provenance === 'corroborated').map((l) => l.itemId)).toEqual(['i-repo']);
    // The CV claim is still a claim beside it: cited as a claim, never as proven.
    expect(after.competencies[1]).toMatchObject({
      proven: { level: 3, itemIds: [INTERVIEW] },
      claimItemIds: ['i-cv'],
    });
  });

  // SAFETY: mutation check: removed the `corroborated` exclusion from the items a not_shown weakens -> this test failed (backed score 55 to 0)
  it('not_shown never weakens work a second source checked, alone or beside submitted work at the same level', () => {
    const alone = preview('c-python', 'not_shown');
    expect(alone.changes).toEqual([]);
    expect(alone.after.backedScore).toBe(55);

    const beside: EvidenceLink = { ...DOC, itemId: 'i-writeup', competencyId: 'c-python', level: 5 };
    const { after, changes } = preview('c-python', 'not_shown', [...LINKS, beside]);
    // The corroborated repository still proves level 5 at Strong, so the rating moves nothing and nothing is stored.
    expect(changes).toEqual([]);
    expect(after.competencies[0]?.proven).toEqual({ level: 5, itemIds: ['i-repo', 'i-writeup'] });
    expect(after.backedScore).toBe(55);
  });

  // SAFETY: mutation check: level was `claimedLevel || levelNeeded` again -> this test failed (proven 2, 3 and 5 for one rating)
  it('the same rating backs the same level whatever the candidate claimed', () => {
    const proven = [[REPO], [REPO, cvClaim(2)], [REPO, cvClaim(5)]].map(
      (links) => preview('c-retrieval', 'clearly_shown', links).after.competencies[1]?.proven.level,
    );
    expect(proven).toEqual([3, 3, 3]);
  });

  // SAFETY: mutation check: counts() let a claim-strength link count -> this test failed (backed score 70, not 55)
  it('a claim with nothing to inspect still counts zero after an interview weakened it', () => {
    const weakened = preview('c-cost', 'not_shown', [...LINKS, DOC]).after;
    expect(weakened.competencies[2]?.proven).toEqual({ level: 0, itemIds: [] });
    expect(weakened.backedScore).toBe(55);
  });
});

describe('Stored changes stand in later assessments', () => {
  const withDoc = [...LINKS, DOC];
  const weakened = preview('c-cost', 'not_shown', withDoc).changes.map((c) => c.change);

  it('evidence added after the interview is not weakened by it', () => {
    const later: EvidenceLink[] = [...withDoc, { ...DOC, itemId: 'i-new', level: 2 }];
    expect(assess(RUBRIC, withInterviewChanges(later, weakened)).competencies[2]?.proven).toEqual({
      level: 2,
      itemIds: ['i-new'],
    });
  });

  // SAFETY: mutation check: withInterviewChanges kept only the latest change per competency -> this test failed (interview-1's link was gone)
  it("a later interview never removes another interview's shown link, whatever it rates", () => {
    const strongly = preview('c-retrieval', 'strongly_shown').changes.map((c) => c.change);
    for (const rating of ['clearly_shown', 'not_shown'] as const) {
      const { after, changes } = preview('c-retrieval', rating, LINKS, strongly, 'interview-2');
      expect(changes).toEqual([]);
      expect(after.competencies[1]?.proven).toEqual({ level: 3, itemIds: [INTERVIEW] });
    }
    const second: InterviewChange = {
      ...(strongly[0] as InterviewChange),
      sourceId: 'interview-2',
      strength: 'medium',
    };
    expect(
      withInterviewChanges(LINKS, [...strongly, second])
        .filter((l) => l.competencyId === 'c-retrieval')
        .map((l) => [l.itemId, l.strength]),
    ).toEqual([
      ['i-cv', 'supporting'],
      [INTERVIEW, 'strong'],
      ['interview-2', 'medium'],
    ]);
  });

  it('the same interview rated again replaces its own earlier change', () => {
    const strongly = preview('c-retrieval', 'strongly_shown').changes.map((c) => c.change);
    const { changes } = preview('c-retrieval', 'clearly_shown', LINKS, strongly);
    expect(changes.map((c) => [c.from.strength, c.to.strength])).toEqual([['strong', 'medium']]);
  });

  it('is deterministic: the same input gives the same result', () => {
    expect(preview('c-retrieval', 'clearly_shown')).toEqual(preview('c-retrieval', 'clearly_shown'));
  });
});
