import { MAX_COMPARED } from '@credalent/assessment';
import { describe, expect, it } from 'vitest';
import { MAX_COMPARE, closingOf, compareHref, parseIds, tradeoffsInput, verdictOf } from './compare.ts';

// AIV-P1-047. Synthetic ids only.
const P1 = '0190d4a2-0000-7000-8000-00000000c001';
const P2 = '0190d4a2-0000-7000-8000-00000000c002';

describe('the comparison limits', () => {
  it('holds as many candidates as the assessment module compares', () => {
    expect(MAX_COMPARE).toBe(MAX_COMPARED);
  });

  it('refuses a trade-offs request outside 2 to 10 candidates, or with anything but ids', () => {
    const ask = (candidateIds: unknown) => tradeoffsInput.safeParse({ jobId: P1, candidateIds }).success;
    expect(ask([P1, P2])).toBe(true);
    expect(ask([P1])).toBe(false);
    expect(ask(Array.from({ length: 11 }, () => P1))).toBe(false);
    expect(ask([P1, 'Sara Al Qahtani'])).toBe(false);
  });
});

describe('the comparison address', () => {
  it('names the job and the person ids', () => {
    expect(compareHref('j1', ['p1', 'p2'])).toBe('/app/jobs/j1/compare?ids=p1,p2');
  });

  it('reads the ids in the order given, once each; none when absent', () => {
    expect(parseIds(`${P2},${P1},${P2}`)).toEqual([P2, P1]);
    expect(parseIds(undefined)).toEqual([]);
    expect(parseIds('')).toEqual([]);
  });

  it('is malformed for anything that is not a list of ids', () => {
    expect(parseIds(`${P1},sara`)).toBeNull();
    expect(parseIds([P1, P2])).toBeNull();
    expect(
      parseIds(Array.from({ length: 51 }, (_, i) => `0190d4a2-0000-7000-8000-0000000000${10 + i}`).join()),
    ).toBeNull();
  });
});

describe('a cell’s verdict', () => {
  it('judges the proven level against the level the job needs', () => {
    expect([verdictOf(5, 4), verdictOf(3, 3), verdictOf(0, 2)]).toEqual(['above', 'meets', 'below']);
  });
});

const column = (backed: number, upTo: number) => ({ score: { backed, upTo } });

describe('the closing line', () => {
  it('counts the points between the highest and lowest backed score', () => {
    expect(closingOf([column(68, 84), column(64, 76), column(61, 82)])).toEqual({
      points: 7,
      count: 3,
      couldChange: true,
    });
  });

  // SAFETY: mutation check: couldChange set to true always -> this test failed
  it('says the order could change only when a lower candidate’s "up to" reaches the highest backed score', () => {
    expect(closingOf([column(80, 90), column(40, 60)])?.couldChange).toBe(false);
    expect(closingOf([column(70, 70), column(70, 70)])?.couldChange).toBe(false);
  });

  it('is absent until every candidate is scored', () => {
    expect(closingOf([column(68, 84), { score: null }])).toBeNull();
  });
});
