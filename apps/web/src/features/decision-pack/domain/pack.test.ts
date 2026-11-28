import { describe, expect, it } from 'vitest';
import { byBackedScore, byNeed, numberedSources, standing } from './pack.ts';

// AIV-P1-116: "Backed by evidence" and "Still to test in the interview" in the hiring owner's preview.
const row = (competencyId: string, proven: number, needed: number) => ({
  competencyId,
  name: competencyId,
  proven,
  claimed: proven,
  needed,
});

describe('byNeed', () => {
  it('a competency proven at the level the job needs is a strength; one level below is still to test', () => {
    const [meets, above, short] = [row('meets', 3, 3), row('above', 4, 3), row('short', 2, 3)];
    expect(byNeed([meets, above, short])).toEqual({ strengths: [meets, above], risks: [short] });
  });
});

// AIV-P1-165 section 13: the pack reads in order of backed score, and one line separates each member from the one above.
describe('byBackedScore and standing', () => {
  const [maria, priya, daniel] = [
    { name: 'Maria Santos', backedScore: 31, upperBound: 69 },
    { name: 'Priya Nair', backedScore: 49, upperBound: 77 },
    { name: 'Daniel Novak', backedScore: 55, upperBound: 78 },
  ];

  it('orders by backed score, highest first, without changing the pack it was given', () => {
    const joined = [maria, priya, daniel];
    expect(byBackedScore(joined).map((m) => m.name)).toEqual(['Daniel Novak', 'Priya Nair', 'Maria Santos']);
    expect(joined[0]).toBe(maria);
  });

  // SAFETY: mutation check: sorted by upperBound instead of backedScore -> this test failed (a claim range moved a member up)
  it('never lets a claim range reorder members: a tie keeps the order they joined in', () => {
    const [first, second] = [
      { name: 'Priya Nair', backedScore: 49, upperBound: 60 },
      { name: 'Maria Santos', backedScore: 49, upperBound: 90 },
    ];
    expect(byBackedScore([first, second])).toEqual([first, second]);
    expect(byBackedScore([{ name: 'Daniel Novak', backedScore: 40, upperBound: 99 }, first])[0]).toBe(first);
  });

  it('says what separates a member from the one above', () => {
    const ordered = byBackedScore([maria, priya, daniel]);
    expect(standing(ordered, 0, '')).toEqual({ key: 'first' });
    expect(standing(ordered, 1, 'Daniel Novak')).toEqual({ key: 'below', name: 'Daniel Novak', points: 6 });
    expect(standing([priya, { ...maria, backedScore: 49 }], 1, 'Priya Nair')).toEqual({
      key: 'level',
      name: 'Priya Nair',
    });
  });
});

const cite = (itemId: string | null, quote: string) => ({
  itemId,
  label: itemId ?? 'Assessment',
  quote,
  claim: false,
});

describe('numberedSources', () => {
  it('numbers each source once, in the order first cited, the facts included', () => {
    const [repo, facts, again] = [cite('repo', 'a'), cite(null, 'b'), cite('repo', 'c')];
    expect(numberedSources([repo, facts, again, cite(null, 'd')])).toEqual([repo, facts]);
  });
});
