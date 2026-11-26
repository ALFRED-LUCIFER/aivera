import { describe, expect, it } from 'vitest';
import { byNeed } from './pack.ts';

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
