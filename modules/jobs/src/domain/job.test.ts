import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  assertValidCompetencies,
  assertValidPayBand,
  editsInPlace,
  RUBRIC_STATUSES,
  type Competency,
} from './job.ts';

const rubric = (weights: number[], level = 3): Competency[] =>
  weights.map((weightPercent, i) => ({
    name: `Competency ${i + 1}`,
    evidenceExpected: 'A repository or a document',
    weightPercent,
    levelNeeded: level,
    type: 'mandatory',
    origin: 'from_description',
  }));

describe('Scenario: Weights must total 100', () => {
  it("weights 25, 20, 15, 15, 15 and 10 are valid (the ticket's 25, 20, 15, 15, 10, 10 totals 95)", () => {
    expect(() => assertValidCompetencies(rubric([25, 20, 15, 15, 15, 10]))).not.toThrow();
  });

  // SAFETY: mutation check: removed the total check in assertValidCompetencies -> this test failed
  it('a total of 105 fails with "Weights must total 100%."', () => {
    expect(() => assertValidCompetencies(rubric([30, 20, 15, 15, 10, 15]))).toThrow('Weights must total 100%.');
  });

  it.each([[[0, 100]], [[100.5, -0.5]], [[101, -1]]])('weights %j are refused one by one', (weights) => {
    expect(() => assertValidCompetencies(rubric(weights))).toThrow('Each weight is a whole percentage from 1 to 100.');
  });

  it('a rubric with no competencies is refused', () => {
    expect(() => assertValidCompetencies([])).toThrow('A rubric needs at least one competency.');
  });
});

describe('The level needed is 1 to 5', () => {
  it.each([1, 5])('level %i is valid', (level) => {
    expect(() => assertValidCompetencies(rubric([100], level))).not.toThrow();
  });
  it.each([0, 6, 2.5])('level %d is refused', (level) => {
    expect(() => assertValidCompetencies(rubric([100], level))).toThrow(
      'The level needed is a whole number from 1 to 5.',
    );
  });
});

describe('Versions', () => {
  it('a version not yet approved is edited in place; an approved one, or none, starts the next version', () => {
    expect(RUBRIC_STATUSES.filter((status) => editsInPlace({ status }))).toEqual([
      'draft',
      'awaiting_approval',
      'returned',
    ]);
    expect(editsInPlace(null)).toBe(false);
  });

  it('only a version awaiting approval can be approved, and only an approved one superseded', () => {
    const allowed = RUBRIC_STATUSES.flatMap((from) =>
      RUBRIC_STATUSES.flatMap((to) => {
        try {
          assertTransition(from, to);
          return [`${from}->${to}`];
        } catch {
          return [];
        }
      }),
    );
    expect(allowed).toEqual([
      'draft->awaiting_approval',
      'awaiting_approval->approved',
      'approved->superseded',
      'returned->awaiting_approval',
    ]);
  });
});

describe('Pay band', () => {
  it('is integer minor units with a three-letter currency, minimum no higher than maximum', () => {
    expect(() => assertValidPayBand({ minMinor: 2_000_000, maxMinor: 3_000_000, currency: 'AED' })).not.toThrow();
    expect(() => assertValidPayBand(null)).not.toThrow();
    for (const band of [
      { minMinor: 3, maxMinor: 2, currency: 'AED' },
      { minMinor: 1.5, maxMinor: 2, currency: 'AED' },
      { minMinor: 1, maxMinor: 2, currency: 'aed' },
    ])
      expect(() => assertValidPayBand(band)).toThrow('pay band');
  });
});
