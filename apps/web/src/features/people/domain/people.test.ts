import { describe, expect, it } from 'vitest';
import type { CandidateRow } from '@/features/ranking/domain/ranking.ts';
import { ALL_JOBS, parseTab, peopleOnTab, toPeople } from './people.ts';

// AIV-P1-048: the Gherkin scenarios "All jobs", "One job tab", "Sorted furthest along first" and "Pool and Inbox are
// not mixed in". Synthetic cast only (docs/00-product/personas.md).
const at = new Date('2026-11-14T08:00:00.000Z');
const row = (personId: string, name: string, backed: number, more: Partial<CandidateRow> = {}): CandidateRow => ({
  id: `a-${personId}-${backed}`,
  personId,
  name,
  stage: 'new',
  score: {
    rank: 1,
    backedScore: backed,
    upperBound: backed + 10,
    meetsNeed: 3,
    competencyCount: 6,
    confidence: 'High',
    assessedAt: at,
    missing: [],
    investigate: [],
  },
  ...more,
});
const ai = { id: 'j-ai', title: 'Senior AI Engineer' };
const backend = { id: 'j-be', title: 'Staff Backend Engineer' };
const qa = { id: 'j-qa', title: 'QA Automation Engineer' };

describe('toPeople', () => {
  it('lists a person in two jobs once, on their furthest-along job, with the other job under it', () => {
    const data = toPeople([
      { ...ai, rows: [row('sara', 'Sara Al Qahtani', 68, { inPack: true })] },
      { ...backend, rows: [row('sara', 'Sara Al Qahtani', 46, { stage: 'interview' })] },
    ]);
    expect(data.people).toHaveLength(1);
    expect(data.people[0]?.job).toMatchObject({ jobTitle: 'Senior AI Engineer', row: { score: { backedScore: 68 } } });
    expect(data.people[0]?.others.map((j) => j.jobTitle)).toEqual(['Staff Backend Engineer']);
    expect(data.jobs).toEqual([
      { id: 'j-ai', title: 'Senior AI Engineer', count: 1 },
      { id: 'j-be', title: 'Staff Backend Engineer', count: 1 },
    ]);
  });

  // mutation check: ranked every pack member above every stage -> this test failed (Arjun before Karim's Round 2 shortlist)
  it('puts people in a shortlist pack before people only assessed, then the higher backed score', () => {
    const data = toPeople([
      {
        ...ai,
        rows: [
          row('hessa', 'Hessa Al Mazrouei', 72),
          row('arjun', 'Arjun Menon', 64, { inPack: true }),
          row('daniel', 'Daniel Novak', 55, { stage: 'interview' }),
          row('tarek', 'Tarek Mansour', 63),
          row('karim', 'Karim Nasser', 40, { stage: 'round2_shortlist' }),
          row('rana', 'Rana Khoury', 58, { stage: 'not_advanced' }),
        ],
      },
    ]);
    // A recorded Round 2 shortlist, then an undecided pack, then chosen for interview, then assessed, then not advanced.
    expect(data.people.map((p) => p.job.row.name)).toEqual([
      'Karim Nasser',
      'Arjun Menon',
      'Daniel Novak',
      'Hessa Al Mazrouei',
      'Tarek Mansour',
      'Rana Khoury',
    ]);
  });

  // SAFETY: mutation check: dropped the `!PROGRESS.includes(row.stage)` test -> this test failed (pool and withdrawn listed)
  it('leaves out the not yet assessed and anyone in the talent pool or withdrawn', () => {
    const data = toPeople([
      {
        ...qa,
        rows: [
          row('hessa', 'Hessa Al Mazrouei', 72),
          { ...row('omar', 'Omar Al Suwaidi', 0), score: null },
          row('priya', 'Priya Nair', 49, { stage: 'in_pool' }),
          row('layla', 'Layla Haddad', 61, { stage: 'withdrawn' }),
        ],
      },
    ]);
    expect(data.people.map((p) => p.personId)).toEqual(['hessa']);
    expect(data.jobs).toEqual([{ id: 'j-qa', title: 'QA Automation Engineer', count: 1 }]);
  });

  it('has no rows and no tabs with no assessed people', () => {
    expect(toPeople([{ ...ai, rows: [] }])).toEqual({ jobs: [], people: [] });
  });
});

describe('peopleOnTab', () => {
  const data = toPeople([
    { ...ai, rows: [row('sara', 'Sara Al Qahtani', 68, { inPack: true }), row('arjun', 'Arjun Menon', 64)] },
    { ...qa, rows: [row('sara', 'Sara Al Qahtani', 40), row('hessa', 'Hessa Al Mazrouei', 72)] },
  ]);

  it('shows a job tab with that job figures, even when it is not the person furthest-along job', () => {
    const rows = peopleOnTab(data, 'j-qa');
    expect(rows.map((p) => [p.job.row.name, p.job.row.score.backedScore])).toEqual([
      ['Hessa Al Mazrouei', 72],
      ['Sara Al Qahtani', 40],
    ]);
    expect(rows[1]?.others.map((j) => j.jobTitle)).toEqual(['Senior AI Engineer']);
  });

  it('shows everyone on "All jobs"', () => {
    expect(peopleOnTab(data, ALL_JOBS)).toBe(data.people);
  });

  it('reads an unknown or missing job from the URL as "All jobs"', () => {
    expect(parseTab('j-qa', data)).toBe('j-qa');
    expect(parseTab('j-gone', data)).toBe(ALL_JOBS);
    expect(parseTab(null, data)).toBe(ALL_JOBS);
  });
});
