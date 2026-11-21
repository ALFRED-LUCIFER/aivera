import { describe, expect, it } from 'vitest';
import {
  approvesAs,
  assertTransition,
  assertValidCompetencies,
  assertValidPayBand,
  describeChanges,
  editsInPlace,
  newSuggestions,
  rebalanceWeights,
  nextAction,
  RUBRIC_STATUSES,
  toPublicListing,
  validPublicDescriptor,
  validReturnNote,
  type Competency,
  type Job,
} from './job.ts';
import { CATALOGUE_V1 } from '../infrastructure/catalogue-v1.fixture.ts';

const rubric = (weights: number[], level = 3): Competency[] =>
  weights.map((weightPercent, i) => ({
    name: `Competency ${i + 1}`,
    evidenceExpected: 'A repository or a document',
    weightPercent,
    levelNeeded: level,
    type: 'mandatory',
    origin: 'from_description',
  }));

const named = (weights: number[]) =>
  rubric(weights).map((c, i) => ({ ...c, name: ['Cost and reliability', 'Product judgement', 'Python'][i] ?? c.name }));

describe('Scenario: Editing creates a draft version 3 (AIV-P1-013): the change note', () => {
  it('weights raised and lowered, in the edited order', () => {
    expect(describeChanges(named([15, 15, 70]), named([20, 10, 70]))).toBe(
      'Cost and reliability raised from 15% to 20%; Product judgement lowered from 15% to 10%.',
    );
  });

  it('level, type, added and removed; names match without case or extra spaces', () => {
    const before = named([50, 30, 20]);
    const after = [
      { ...before[0], name: ' cost and  reliability', levelNeeded: 4 },
      { ...before[1], type: 'desirable' },
      { ...before[2], name: 'Arabic NLP' },
    ] as Competency[];
    expect(describeChanges(before, after)).toBe(
      ' cost and  reliability level changed from 3 of 5 to 4 of 5; Product judgement changed to desirable; ' +
        'Arabic NLP added; Python removed.',
    );
  });

  it('no change, no note', () => {
    expect(describeChanges(named([50, 50]), named([50, 50]))).toBeNull();
  });
});

describe('Scenario: Weights must total 100', () => {
  it("weights 25, 20, 15, 15, 15 and 10 are valid (the ticket's 25, 20, 15, 15, 10, 10 totals 95)", () => {
    expect(() => assertValidCompetencies(rubric([25, 20, 15, 15, 15, 10]), CATALOGUE_V1)).not.toThrow();
  });

  // SAFETY: mutation check: removed the total check in assertValidCompetencies -> this test failed
  it('a total of 105 fails with "Weights must total 100%."', () => {
    expect(() => assertValidCompetencies(rubric([30, 20, 15, 15, 10, 15]), CATALOGUE_V1)).toThrow(
      'Weights must total 100%.',
    );
  });

  it.each([[[0, 100]], [[100.5, -0.5]], [[101, -1]]])('weights %j are refused one by one', (weights) => {
    expect(() => assertValidCompetencies(rubric(weights), CATALOGUE_V1)).toThrow(
      'Each weight is a whole percentage from 1 to 100.',
    );
  });

  it('a rubric with no competencies is refused', () => {
    expect(() => assertValidCompetencies([], CATALOGUE_V1)).toThrow('A rubric needs at least one competency.');
  });
});

const one = (change: Partial<Competency>): Competency[] => rubric([100]).map((c) => ({ ...c, ...change }));

describe('Domain pack competencies (AIV-P1-064)', () => {
  const pack = { origin: 'domain_pack', packKey: 'payments_fintech', packVersion: 1 } as const;

  it('a pack competency names its pack and version, and no other competency does', () => {
    expect(() => assertValidCompetencies(one(pack), CATALOGUE_V1)).not.toThrow();
    for (const change of [
      { ...pack, packKey: null },
      { ...pack, packVersion: null },
      { ...pack, packKey: 'crypto' as NonNullable<Competency['packKey']> },
      { origin: 'domain_pack' as const },
    ])
      expect(() => assertValidCompetencies(one(change), CATALOGUE_V1)).toThrow(
        'A competency from a domain pack names its pack',
      );
    expect(() => assertValidCompetencies(one({ packKey: 'payments_fintech', packVersion: 1 }), CATALOGUE_V1)).toThrow(
      'A competency from a domain pack names its pack',
    );
  });

  it('AIV-P2-044: the pack is checked against the published catalogue: a newer version is refused, a retired pack only kept', () => {
    // SAFETY: mutation check: removed `c.packVersion <= catalogue.version` in assertValidCompetencies -> this test failed
    expect(() => assertValidCompetencies(one({ ...pack, packVersion: 2 }), CATALOGUE_V1)).toThrow(
      'A competency from a domain pack names its pack',
    );
    const retired = { ...CATALOGUE_V1, packs: CATALOGUE_V1.packs.map((p) => ({ ...p, retired: true })) };
    // SAFETY: mutation check: accepted a retired pack without a kept competency in assertValidCompetencies -> this test failed
    expect(() => assertValidCompetencies(one(pack), retired)).toThrow('A competency from a domain pack names its pack');
    expect(() => assertValidCompetencies(one(pack), retired, one(pack))).not.toThrow();
    expect(() => assertValidCompetencies(one(pack), retired, one({ ...pack, name: 'Another' }))).toThrow(
      'A competency from a domain pack names its pack',
    );
  });

  // SAFETY: mutation check: removed the isRegionalHint check in assertValidCompetencies -> this test failed
  it('a regional hint is never mandatory, whatever its origin', () => {
    const hint = { name: 'Aani instant payments', type: 'mandatory' } as const;
    expect(() => assertValidCompetencies(one({ ...pack, ...hint }), CATALOGUE_V1)).toThrow(
      'Regional knowledge is shown through evidence, so it can only be desirable.',
    );
    expect(() => assertValidCompetencies(one({ ...hint, name: ' aani  INSTANT payments' }), CATALOGUE_V1)).toThrow(
      'Regional knowledge is shown through evidence',
    );
    expect(() => assertValidCompetencies(one({ ...pack, ...hint, type: 'desirable' }), CATALOGUE_V1)).not.toThrow();
    // A core pack competency may be raised to mandatory; the hiring owner approves the rubric.
    expect(() =>
      assertValidCompetencies(one({ ...pack, name: 'Reconciliation and settlement' }), CATALOGUE_V1),
    ).not.toThrow();
  });
});

describe('Scenario: Suggestions never duplicate drafted competencies (AIV-P1-009)', () => {
  // SAFETY: mutation check: newSuggestions returned every suggestion unfiltered -> this test and the draft one failed
  it('drops a suggestion named like a drafted competency or an earlier suggestion, ignoring case and spaces', () => {
    const drafted = [{ name: 'Cost and reliability' }, { name: 'Retrieval and evaluation' }];
    const suggestions = [
      { name: ' cost  and Reliability ' },
      { name: 'Arabic and bilingual NLP' },
      { name: 'arabic and bilingual nlp' },
      { name: 'Product judgement' },
    ];
    expect(newSuggestions(drafted, suggestions).map((s) => s.name)).toEqual([
      'Arabic and bilingual NLP',
      'Product judgement',
    ]);
  });
});

const weights = (list: Competency[]) => list.map((c) => c.weightPercent);

describe('Scenario: Weights rebalance when a suggestion was removed (AIV-P1-010)', () => {
  it('scales 85 to 100 and gives the missing points to the largest remainders', () => {
    // 25 20 15 15 10 (Product judgement's 15 removed): 29.41 23.53 17.65 17.65 11.76 round down to 97; the three
    // largest remainders (.76, .65, .65) get a point each.
    expect(weights(rebalanceWeights(rubric([25, 20, 15, 15, 10])))).toEqual([29, 23, 18, 18, 12]);
  });

  it('keeps weights that already total 100, and keeps every other field', () => {
    const six = rubric([25, 20, 15, 15, 15, 10]);
    expect(rebalanceWeights(six)).toBe(six);
    expect(rebalanceWeights(rubric([30, 30], 4)).map((c) => [c.weightPercent, c.levelNeeded, c.name])).toEqual([
      [50, 4, 'Competency 1'],
      [50, 4, 'Competency 2'],
    ]);
  });

  // AIV-P1-082 review: the old rule (round down, at least 1, remainder to the heaviest) broke the order on each of these.
  // SAFETY: mutation check: pinning pass not repeated in rebalanceWeights -> the 3s-and-2s case failed (3s got 0)
  it.each([
    // The 1% floor pushed the sum over 100 and the heaviest paid for it: [13,14,14,14,14,14,14,1,1,1] before.
    [
      [100, 99, 99, 99, 99, 99, 99, 1, 1, 1],
      [14, 14, 14, 14, 14, 14, 13, 1, 1, 1],
    ],
    // [36,24,1,1,35,1,1,1] before: 94 ended above 95.
    [
      [94, 63, 3, 2, 95, 1, 1, 1],
      [35, 24, 1, 1, 36, 1, 1, 1],
    ],
    // The whole remainder on one row: [37, 7 x 9] before.
    [
      [40, 10, 10, 10, 10, 10, 10, 10, 10, 10],
      [31, 8, 8, 8, 8, 8, 8, 7, 7, 7],
    ],
    // Equal weights end within 1 of each other: [20,16,16,16,16,16] before.
    [
      [30, 30, 30, 30, 30, 30],
      [17, 17, 17, 17, 16, 16],
    ],
    // Pinning the sixty 2s to 1% lowers the twenty 3s' share to 0.67%, so they are pinned on the next pass, never 0.
    [
      [...Array.from({ length: 20 }, () => 3), ...Array.from({ length: 60 }, () => 2), 60, 60],
      [...Array.from({ length: 80 }, () => 1), 10, 10],
    ],
  ])('scales %j to %j', (input, output) => {
    expect(weights(rebalanceWeights(rubric(input)))).toEqual(output);
  });

  // SAFETY: mutation check: missing points given in list order, not by largest remainder, in rebalanceWeights -> this test
  // failed ("99 ended lighter than 97"), as did the 85-to-100 and [94,63,...] cases
  // SAFETY: mutation check: restored the old rule (round down, at least 1, remainder to the heaviest) -> this test failed
  // ("equal weights 100: expected 7 to be less than or equal to 1"), as did every case above
  it('always totals exactly 100, whole percents 1 to 100, heavier never lighter, equal within 1 (2,000 rubrics)', () => {
    let seed = 7;
    const random = () => (seed = (seed * 48_271) % 2_147_483_647) / 2_147_483_647; // a fixed-seed generator
    // Every other rubric mixes heavy weights with many of 1 to 3, the shape that pushes weights onto the 1% floor.
    const weight = (skewed: boolean) =>
      skewed && random() < 0.5 ? 1 + Math.floor(random() * 3) : 1 + Math.floor(random() * 100);
    // Violations are collected and asserted once: an expect per pair (~800k) timed the test out on CI.
    const failures: string[] = [];
    for (let run = 0; run < 2_000; run++) {
      const list = Array.from({ length: 1 + Math.floor(random() * 20) }, () => weight(run % 2 === 1));
      const result = weights(rebalanceWeights(rubric(list)));
      const label = list.join(' ');
      if (result.reduce((a, b) => a + b, 0) !== 100) failures.push(`${label}: total is not 100`);
      for (const [i, w] of result.entries()) {
        if (!(Number.isInteger(w) && w >= 1 && w <= 100)) failures.push(`${label}: weight ${w} out of 1 to 100`);
        for (const [j, v] of result.entries()) {
          const [a, b] = [list[i] ?? 0, list[j] ?? 0];
          if (a > b && w < v) failures.push(`${label}: ${a} ended lighter than ${b}`);
          if (a === b && Math.abs(w - v) > 1) failures.push(`${label}: equal weights ${a} differ by more than 1`);
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });
});

describe('The level needed is 1 to 5', () => {
  it.each([1, 5])('level %i is valid', (level) => {
    expect(() => assertValidCompetencies(rubric([100], level), CATALOGUE_V1)).not.toThrow();
  });
  it.each([0, 6, 2.5])('level %d is refused', (level) => {
    expect(() => assertValidCompetencies(rubric([100], level), CATALOGUE_V1)).toThrow(
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

  // ADR-014: a recruiter approves a draft or returned version directly; only a version sent for approval is returned.
  // SAFETY: mutation check: dropped 'approved' from draft's transitions -> this test failed
  it('a draft or returned version is approved directly or sent; only a sent one is returned; only an approved one superseded', () => {
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
      'draft->approved',
      'awaiting_approval->approved',
      'awaiting_approval->returned',
      'approved->superseded',
      'returned->awaiting_approval',
      'returned->approved',
    ]);
  });
});

describe('Scenario: Who approves a rubric (AIV-P1-014, ADR-014)', () => {
  const job = { hiringOwnerUserId: 'owner' };

  // SAFETY: mutation check: let any hiring owner approve (dropped the owner id comparison) -> this test failed
  // SAFETY: mutation check: made an interviewer a 'recruiter' approver -> this test failed
  it("is an admin or recruiter on the job, or the job's own hiring owner; no one else", () => {
    expect(approvesAs('hiring_owner', 'owner', job)).toBe('owner');
    expect(approvesAs('admin', 'owner', job)).toBe('owner');
    expect(approvesAs('admin', 'someone', job)).toBe('recruiter');
    expect(approvesAs('recruiter', 'someone', job)).toBe('recruiter');
    expect(approvesAs('recruiter', 'someone', { hiringOwnerUserId: null })).toBe('recruiter');
    expect(approvesAs('hiring_owner', 'another-owner', job)).toBeNull();
    expect(approvesAs('interviewer', 'someone', { hiringOwnerUserId: null })).toBeNull();
    // An owner moved to another role since no longer decides.
    expect(approvesAs('interviewer', 'owner', job)).toBeNull();
  });

  it('a return needs a note of 1 to 1,000 characters', () => {
    expect(validReturnNote('  Arabic NLP should be desirable ')).toBe('Arabic NLP should be desirable');
    expect(() => validReturnNote('   ')).toThrow('Write a note');
    expect(() => validReturnNote('x'.repeat(1001))).toThrow('Write a note');
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
      { minMinor: 1, maxMinor: 2_147_483_648, currency: 'AED' },
    ])
      expect(() => assertValidPayBand(band)).toThrow('pay band');
  });
});

describe('toPublicListing (AIV-P1-015)', () => {
  const job: Job = {
    id: '0190d4a2-0000-7000-8000-000000000001',
    workspaceId: '0190d4a2-0000-7000-8000-000000000002',
    title: 'Senior AI Engineer',
    jobType: 'ai_llm_engineering',
    description: 'Falcon Pay is hiring.',
    team: 'AI platform',
    clientId: '0190d4a2-0000-7000-8000-000000000003',
    location: 'DIFC, Dubai',
    hiringOwnerUserId: '0190d4a2-0000-7000-8000-000000000004',
    stage: 'collecting_evidence',
    published: true,
    publicDescriptor: 'A BNPL fintech',
    publishedAt: new Date('2026-11-12T09:00:00.000Z'),
    payBand: { minMinor: 3_500_000, maxMinor: 4_800_000, currency: 'AED' },
    synthetic: true,
    createdBy: '0190d4a2-0000-7000-8000-000000000005',
    createdAt: new Date('2026-11-01T09:00:00.000Z'),
  };

  // SAFETY: mutation check: added `weightPercent` to the competency mapping in toPublicListing -> this test failed
  it('keeps only the allow-listed fields: no weight, client, description, ids or workspace', () => {
    const listing = toPublicListing(job, rubric([60, 40], 4));
    expect(listing).toEqual({
      title: 'Senior AI Engineer',
      jobType: 'ai_llm_engineering',
      descriptor: 'A BNPL fintech',
      location: 'DIFC, Dubai',
      payBand: { minMinor: 3_500_000, maxMinor: 4_800_000, currency: 'AED' },
      competencies: [
        { name: 'Competency 1', evidenceExpected: 'A repository or a document', levelNeeded: 4 },
        { name: 'Competency 2', evidenceExpected: 'A repository or a document', levelNeeded: 4 },
      ],
    });
    // Nothing private survives anywhere in the object, at any depth.
    const text = JSON.stringify(listing);
    for (const hidden of [job.id, job.workspaceId, job.clientId, 'Falcon Pay', 'weight', 'AI platform']) {
      expect(text).not.toContain(hidden);
    }
  });

  it('validPublicDescriptor trims, and refuses blank or over 80 characters', () => {
    expect(validPublicDescriptor('  A retail bank ')).toBe('A retail bank');
    expect(() => validPublicDescriptor(' ')).toThrow('Describe the employer for candidates');
    expect(() => validPublicDescriptor('x'.repeat(81))).toThrow('Describe the employer for candidates');
  });
});

describe('Next action on the Jobs list (AIV-P1-006)', () => {
  const unknown = { packReady: null, openEvidenceRequests: null };
  const approved = { approved: true, latest: 'approved' } as const;

  it.each([
    [null, 'approve_rubric'],
    ['draft', 'approve_rubric'],
    ['returned', 'approve_rubric'],
    ['awaiting_approval', 'rubric_approval_pending'],
  ] as const)('a latest rubric version %s gives %s', (latest, kind) => {
    expect(nextAction({ approved: false, latest }, unknown)).toEqual({ kind });
  });

  it('a new draft is sent for approval first, even while an older version is in force', () => {
    expect(nextAction({ approved: true, latest: 'draft' }, { packReady: true, openEvidenceRequests: 3 })).toEqual({
      kind: 'approve_rubric',
    });
  });

  it('a ready pack asks for the Round 2 shortlist decision before chasing evidence', () => {
    expect(nextAction(approved, { packReady: true, openEvidenceRequests: 3 })).toEqual({ kind: 'decide_shortlist' });
  });

  it('open evidence requests are chased with their count', () => {
    expect(nextAction(approved, { packReady: false, openEvidenceRequests: 3 })).toEqual({
      kind: 'chase_evidence',
      count: 3,
    });
  });

  it('an approved rubric with nothing to do, or with progress not yet available, has no action', () => {
    expect(nextAction(approved, { packReady: false, openEvidenceRequests: 0 })).toBeNull();
    expect(nextAction(approved, unknown)).toBeNull();
  });
});
