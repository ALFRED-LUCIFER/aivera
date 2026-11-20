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

  it('AIV-P2-044: the pack is checked against the published catalogue: a newer version is refused, a retired pack kept', () => {
    // SAFETY: mutation check: removed `c.packVersion <= catalogue.version` in assertValidCompetencies -> this test failed
    expect(() => assertValidCompetencies(one({ ...pack, packVersion: 2 }), CATALOGUE_V1)).toThrow(
      'A competency from a domain pack names its pack',
    );
    const retired = { ...CATALOGUE_V1, packs: CATALOGUE_V1.packs.map((p) => ({ ...p, retired: true })) };
    expect(() => assertValidCompetencies(one(pack), retired)).not.toThrow();
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
  it('scales 85 to 100 and gives the rounding remainder to the heaviest', () => {
    // 25 20 15 15 10 (Product judgement's 15 removed): 29.4 23.5 17.6 17.6 11.8 rounds down to 29 23 17 17 11 = 97.
    expect(weights(rebalanceWeights(rubric([25, 20, 15, 15, 10])))).toEqual([32, 23, 17, 17, 11]);
  });

  it('keeps weights that already total 100, and keeps every other field', () => {
    const six = rubric([25, 20, 15, 15, 15, 10]);
    expect(rebalanceWeights(six)).toBe(six);
    expect(rebalanceWeights(rubric([30, 30], 4)).map((c) => [c.weightPercent, c.levelNeeded, c.name])).toEqual([
      [50, 4, 'Competency 1'],
      [50, 4, 'Competency 2'],
    ]);
  });

  // SAFETY: mutation check: remainder no longer added to the heaviest in rebalanceWeights -> this test failed
  // SAFETY: mutation check: Math.floor back to Math.round in rebalanceWeights -> this test failed (heaviest no longer heaviest)
  it('always totals exactly 100, each weight a whole percent from 1 to 100 (1,000 random rubrics)', () => {
    let seed = 7;
    const random = () => (seed = (seed * 48_271) % 2_147_483_647) / 2_147_483_647; // a fixed-seed generator
    for (let run = 0; run < 1_000; run++) {
      const list = Array.from({ length: 1 + Math.floor(random() * 20) }, () => 1 + Math.floor(random() * 100));
      const result = weights(rebalanceWeights(rubric(list)));
      expect(
        result.reduce((a, b) => a + b, 0),
        list.join(' '),
      ).toBe(100);
      for (const w of result) expect(Number.isInteger(w) && w >= 1 && w <= 100, list.join(' ')).toBe(true);
      // The recruiter's order holds: no weight ends above the one that was heaviest.
      const heaviest = result[list.indexOf(Math.max(...list))] ?? 0;
      expect(Math.max(...result), list.join(' ')).toBe(heaviest);
    }
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

  it('only a version awaiting approval can be approved or returned, and only an approved one superseded', () => {
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
      'awaiting_approval->returned',
      'approved->superseded',
      'returned->awaiting_approval',
    ]);
  });
});

describe('Scenario: Only the hiring owner approves (AIV-P1-014)', () => {
  const job = { hiringOwnerUserId: 'owner' };

  // SAFETY: mutation check: let any hiring owner approve (dropped the owner id comparison) -> this test failed
  it("is the job's own hiring owner, or an admin acting as owner; no one else", () => {
    expect(approvesAs('hiring_owner', 'owner', job)).toBe('owner');
    expect(approvesAs('admin', 'someone', job)).toBe('admin_as_owner');
    expect(approvesAs('hiring_owner', 'another-owner', job)).toBeNull();
    expect(approvesAs('recruiter', 'someone', job)).toBeNull();
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
    [null, 'send_rubric'],
    ['draft', 'send_rubric'],
    ['returned', 'send_rubric'],
    ['awaiting_approval', 'rubric_approval_pending'],
  ] as const)('a latest rubric version %s gives %s', (latest, kind) => {
    expect(nextAction({ approved: false, latest }, unknown)).toEqual({ kind });
  });

  it('a new draft is sent for approval first, even while an older version is in force', () => {
    expect(nextAction({ approved: true, latest: 'draft' }, { packReady: true, openEvidenceRequests: 3 })).toEqual({
      kind: 'send_rubric',
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
