import { describe, expect, it } from 'vitest';
import { assess, type EvidenceLink, type RubricInput } from './assess.ts';
import {
  previewRatings,
  RATINGS,
  strengthOf,
  withInterviewChanges,
  type InterviewChange,
  type Rating,
} from './scoreChange.ts';

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
// His own write-up of the same work as the repository: submitted, at the same level.
const WRITEUP: EvidenceLink = { ...DOC, itemId: 'i-writeup', competencyId: 'c-python', level: 5 };
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

  it.each(['clearly_shown', 'strongly_shown'] as const)(
    '%s: Supporting to Medium at the level the job needs, cited to the interview, 55 to 67',
    (rating) => {
      const { before, after, changes } = preview('c-retrieval', rating);
      expect([before.backedScore, after.backedScore]).toEqual([55, 67]);
      expect(changes.map((c) => [c.rating, c.from, c.to, c.noChange])).toEqual([
        [rating, { strength: 'supporting', provenLevel: 0 }, { strength: 'medium', provenLevel: 3 }, null],
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

  it('a rating that moves nothing now is still listed, with why, so it is stored', () => {
    expect(preview('c-python', 'clearly_shown').changes.map((c) => [c.from, c.to, c.noChange])).toEqual([
      [{ strength: 'strong', provenLevel: 5 }, { strength: 'strong', provenLevel: 5 }, 'outranked_by_checked_work'],
    ]);
    expect(preview('c-cost', 'not_shown').changes.map((c) => [c.from, c.to, c.noChange])).toEqual([
      [{ strength: null, provenLevel: 0 }, { strength: null, provenLevel: 0 }, 'no_effect'],
    ]);
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
      strength: 'medium',
      provenance: 'submitted',
    });
    expect(links.filter((l) => l.provenance === 'corroborated').map((l) => l.itemId)).toEqual(['i-repo']);
    // The CV claim is still a claim beside it: cited as a claim, never as proven.
    expect(after.competencies[1]).toMatchObject({
      proven: { level: 3, itemIds: [INTERVIEW] },
      claimItemIds: ['i-cv'],
    });
  });

  // SAFETY: mutation check: TARGET mapped strongly_shown to 'strong' -> this test failed (Strong, confidence Medium to High)
  it('no rating gives Strong or raises confidence: Strong means checked by a second source', () => {
    for (const competencyId of ['c-retrieval', 'c-cost'])
      for (const rating of RATINGS) {
        const { before, after, changes } = preview(competencyId, rating);
        expect(changes.map((c) => c.to.strength)).not.toContain('strong');
        expect(after.confidence).toBe(before.confidence);
        expect(
          withInterviewChanges(
            LINKS,
            changes.map((c) => c.change),
          ).filter((l) => l.itemId === INTERVIEW && l.strength === 'strong'),
        ).toEqual([]);
      }
  });

  // SAFETY: mutation check: removed the `corroborated` exclusion from the items a not_shown weakens -> this test failed (backed score 55 to 0)
  it('not_shown never weakens work a second source checked; submitted work beside it is weakened alone', () => {
    const alone = preview('c-python', 'not_shown');
    expect(alone.changes.map((c) => [c.noChange, c.change.itemIds])).toEqual([['outranked_by_checked_work', []]]);
    expect(alone.after.backedScore).toBe(55);

    const { after, changes } = preview('c-python', 'not_shown', [...LINKS, WRITEUP]);
    expect(changes.map((c) => [c.noChange, c.change.itemIds])).toEqual([['outranked_by_checked_work', ['i-writeup']]]);
    expect(after.competencies[0]?.proven).toEqual({ level: 5, itemIds: ['i-repo'] });
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
    const shown = preview('c-retrieval', 'strongly_shown').changes.map((c) => c.change);
    const cited = { clearly_shown: [INTERVIEW, 'interview-2'], not_shown: [INTERVIEW] };
    for (const rating of ['clearly_shown', 'not_shown'] as const) {
      const { after, changes } = preview('c-retrieval', rating, LINKS, shown, 'interview-2');
      expect(changes.map((c) => c.noChange)).toEqual(['outranked_by_other_interview']);
      expect(after.competencies[1]?.proven).toEqual({ level: 3, itemIds: cited[rating] });
    }
  });

  it('the same interview rated again replaces its own rating, and Partly shown takes it back', () => {
    const shown = preview('c-retrieval', 'clearly_shown').changes.map((c) => c.change);
    const medium = { strength: 'medium', provenLevel: 3 };
    expect(preview('c-retrieval', 'not_shown', LINKS, shown).changes.map((c) => [c.from, c.to])).toEqual([
      [medium, { strength: 'claim', provenLevel: 0 }],
    ]);
    expect(preview('c-retrieval', 'partly_shown', LINKS, shown).changes.map((c) => [c.from, c.to])).toEqual([
      [medium, { strength: 'supporting', provenLevel: 0 }],
    ]);
  });

  // SAFETY: mutation check: previewRatings left out ratings that move nothing now -> both tests below failed
  it('a Not shown outranked by checked work holds when that work is later contradicted', () => {
    const links = [...LINKS, WRITEUP];
    const stored = preview('c-python', 'not_shown', links).changes.map((c) => c.change);
    const contradicted = links.map((l): EvidenceLink => (l === REPO ? { ...l, provenance: 'contradictory' } : l));
    // Without the stored rating the write-up would back level 5 again.
    expect(assess(RUBRIC, contradicted).competencies[0]?.proven.level).toBe(5);
    expect(assess(RUBRIC, withInterviewChanges(contradicted, stored)).competencies[0]?.proven).toEqual({
      level: 0,
      itemIds: [],
    });
  });

  it('an interview re-rated lower while other work covers the competency leaves no stale stronger link', () => {
    const shown = preview('c-python', 'clearly_shown').changes.map((c) => c.change);
    const contradicted: EvidenceLink[] = [{ ...REPO, provenance: 'contradictory' }, cvClaim(4)];
    expect(assess(RUBRIC, withInterviewChanges(contradicted, shown)).competencies[0]?.proven.level).toBe(4);
    for (const rating of ['partly_shown', 'not_shown'] as const) {
      const rerated = preview('c-python', rating, LINKS, shown).changes;
      expect(rerated.map((c) => c.noChange)).toEqual(['outranked_by_checked_work']);
      const stored: InterviewChange[] = [...shown, ...rerated.map((c) => c.change)];
      expect(assess(RUBRIC, withInterviewChanges(contradicted, stored)).competencies[0]?.proven.level).toBe(0);
    }
  });

  it('is deterministic: the same input gives the same result', () => {
    expect(preview('c-retrieval', 'clearly_shown')).toEqual(preview('c-retrieval', 'clearly_shown'));
  });
});
