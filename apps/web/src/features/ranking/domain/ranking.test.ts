import type { RankingRow } from '@credalent/assessment';
import type { ApplicationListItem } from '@credalent/intake';
import { describe, expect, it } from 'vitest';
import { NO_FILTERS, filterRows, missingOptions, stageOptions, toCandidateRows } from './ranking.ts';

// AIV-P1-034. Synthetic cast only (docs/00-product/personas.md).
const at = new Date('2026-11-14T08:00:00.000Z');
const applicant = (n: number, displayName: string | null, stage: ApplicationListItem['stage'] = 'new') => ({
  applicationId: `a${n}`,
  personId: `p${n}`,
  displayName,
  stage,
  receivedAt: at,
  source: 'email' as const,
});
const ranked = (n: number, rank: number, backed: number, upTo: number, missing: string[]): RankingRow => ({
  candidateId: `p${n}`,
  rank,
  backedScore: backed,
  upperBound: upTo,
  meetsNeed: 3,
  competencyCount: 6,
  confidence: 'High',
  missingCritical: missing,
  gaps: missing,
  assessedAt: at,
});
const names: Record<string, string> = { c4: 'Retrieval and evaluation', c5: 'Product judgement' };

// Intake lists newest first: Layla, Omar (not assessed), Arjun, Sara.
const applicants = [
  applicant(3, 'Layla Haddad', 'in_process'),
  applicant(4, 'Omar Al Suwaidi'),
  applicant(2, 'Arjun Menon'),
  applicant(1, 'Sara Al Qahtani'),
];
const ranking = [
  ranked(1, 1, 68, 84, ['c5']),
  ranked(2, 2, 64, 76, ['c4']),
  ranked(3, 3, 61, 82, ['c4', 'gone']),
  ranked(9, 4, 50, 60, []),
];
const rows = toCandidateRows(applicants, ranking, (id) => names[id]);

describe('toCandidateRows', () => {
  it('ranked rows come in rank order, then everyone not yet scored, so nobody drops out of the list', () => {
    expect(rows.map((r) => [r.name, r.score?.rank ?? null])).toEqual([
      ['Sara Al Qahtani', 1],
      ['Arjun Menon', 2],
      ['Layla Haddad', 3],
      ['Omar Al Suwaidi', null],
    ]);
  });

  // The person id reaches the browser since AIV-P1-043: it is the candidate profile's address, an opaque id.
  it('names the missing competencies from the rubric and carries the person id for the profile link', () => {
    expect(rows[0]).toEqual({
      id: 'a1',
      personId: 'p1',
      name: 'Sara Al Qahtani',
      stage: 'new',
      score: {
        rank: 1,
        backedScore: 68,
        upperBound: 84,
        meetsNeed: 3,
        competencyCount: 6,
        confidence: 'High',
        missing: ['Product judgement'],
        investigate: ['Product judgement'],
        assessedAt: at,
      },
    });
    // An id the rubric does not name is left out, never shown raw.
    expect(rows[2]?.score?.missing).toEqual(['Retrieval and evaluation']);
    expect(rows[2]?.score?.investigate).toEqual(['Retrieval and evaluation']);
  });
});

describe('filterRows', () => {
  it('Scenario: Filter by missing evidence: "Retrieval and evaluation" lists Arjun and Layla, not Sara', () => {
    expect(filterRows(rows, { ...NO_FILTERS, missing: 'Retrieval and evaluation' }).map((r) => r.name)).toEqual([
      'Arjun Menon',
      'Layla Haddad',
    ]);
  });

  it('searches names without case, and filters by stage', () => {
    expect(filterRows(rows, { ...NO_FILTERS, query: '  menon ' }).map((r) => r.name)).toEqual(['Arjun Menon']);
    expect(filterRows(rows, { ...NO_FILTERS, stage: 'in_process' }).map((r) => r.name)).toEqual(['Layla Haddad']);
    expect(filterRows(rows, NO_FILTERS)).toHaveLength(4);
  });

  it('offers the stages and missing competencies the rows have, in rank order', () => {
    expect(stageOptions(rows)).toEqual(['new', 'in_process']);
    expect(missingOptions(rows)).toEqual(['Product judgement', 'Retrieval and evaluation']);
  });
});
