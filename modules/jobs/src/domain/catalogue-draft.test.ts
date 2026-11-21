import { describe, expect, it } from 'vitest';
import { CATALOGUE_V1 } from '../infrastructure/catalogue-v1.fixture.ts';
import {
  assertCompetencyFits,
  assertFairCompetency,
  CatalogueError,
  competencyStatus,
  draftCompetencySchema,
  draftPackSchema,
  fairnessRule,
  isNewInDraft,
  packStatus,
  type EditorPack,
  type EditorVersion,
} from './catalogue-draft.ts';

// AIV-P2-045: the rules a catalogue draft save checks (ADR-013 points 5, 6 and 11). Synthetic catalogue text only.

const competency = {
  version: 2,
  revision: 4,
  packKey: 'insurance',
  position: null,
  name: 'Claims processing systems',
  meaning: 'Builds and runs the systems that take a claim from notice to payment.',
  evidence: 'Claims workflow code and tests; incident reviews of claim errors',
  levels: { 1: 'Has fixed a claim bug', 3: 'Owns a claims service', 5: 'Designs claims platforms' },
  appliesTo: ['software_engineering'],
  core: ['software_engineering'],
  levelNeeded: 3 as const,
};

const refusal = (run: () => void) => {
  try {
    run();
  } catch (error) {
    if (error instanceof CatalogueError) return { code: error.code, field: error.field };
    throw error;
  }
  return 'saved';
};

describe('Scenario Outline: Fairness is enforced on save', () => {
  // SAFETY: mutation check: assertFairCompetency returned without checking the rules -> the three refusals failed (saved)
  it.each([
    ['Claims processing systems', 'Claims workflow code and tests', 'saved'],
    ['Worked at a top insurer', 'Employment history', { code: 'fairness_employer', field: 'name' }],
    ['UAE nationals preferred', 'Passport', { code: 'fairness_origin', field: 'name' }],
    ['Claims processing systems', '', { code: 'evidence_required', field: 'evidence' }],
  ])('"%s" with evidence "%s" is %j', (name, evidence, result) => {
    expect(refusal(() => assertFairCompetency({ ...competency, name, evidence }))).toEqual(result);
  });

  it.each([
    ['Worked at a bank', 'employer'],
    ['Ten years at a regulator', 'employer'],
    ['Ex-Careem engineer', 'employer'],
    ['Deloitte audit background', 'employer'],
    ['UAE nationals preferred', 'origin'],
    ['Saudi national', 'origin'],
    ['Indian nationals only', 'origin'],
    ['Citizen of the GCC', 'origin'],
    ['Saudi citizenship', 'origin'],
    ['Native speaker of Arabic', 'origin'],
    ['Resident of Dubai', 'origin'],
    ['Holds a residence visa', 'origin'],
    ['Born in the region', 'origin'],
    ['Candidates from India', 'origin'],
    ['Engineers from the UAE', 'origin'],
  ])('"%s" breaks the %s rule', (text, rule) => {
    expect(fairnessRule(text)).toBe(rule);
  });

  it.each([
    'Payment scheme rules for UAE',
    'National digital identity sign-in',
    'How domestic schemes differ from international card payments',
    'Cloud-native network functions',
    'Reads the payment funnel from checkout to authorisation',
    'Explains index rebalancing',
    'Ex-dividend date handling',
    'Ex-ante and ex-post risk reconciliation',
  ])('the near-miss "%s" passes', (text) => {
    expect(fairnessRule(text)).toBeNull();
  });

  // ADR-013 point 11: version 1 stays editable, so no seeded name or meaning may break a rule.
  it('finds nothing in version 1', () => {
    const texts = CATALOGUE_V1.packs.flatMap((p) =>
      [...p.competencies, ...p.hints].flatMap((c) => [c.name, c.meaning]),
    );
    expect(texts.length).toBeGreaterThan(100);
    expect(texts.filter((t) => fairnessRule(t))).toEqual([]);
  });

  it('checks the meaning too', () => {
    expect(refusal(() => assertFairCompetency({ ...competency, meaning: 'For people born in Riyadh.' }))).toEqual({
      code: 'fairness_origin',
      field: 'meaning',
    });
  });
});

const withPositions = (version: typeof CATALOGUE_V1): EditorVersion => ({
  ...version,
  packs: version.packs.map((p) => ({ ...p, competencies: p.competencies.map((c, position) => ({ ...c, position })) })),
});
const v1 = withPositions(CATALOGUE_V1);
const insurance = (core: number): EditorPack => ({
  key: 'insurance',
  label: { en: 'Insurance and insurtech' },
  retired: false,
  hints: [],
  competencies: Array.from({ length: core }, (_, position) => ({
    ...competency,
    name: `Skill ${position}`,
    type: 'desirable' as const,
    retired: false,
    position,
  })),
});

describe('Scenario: More than four core competencies per job type are refused', () => {
  // SAFETY: mutation check: compared `> CORE_LIMIT` instead of `>= CORE_LIMIT` -> this test failed (saved)
  it('a fifth core for "Software engineering" is refused; a fourth is saved', () => {
    expect(refusal(() => assertCompetencyFits(v1, insurance(4), competency))).toEqual({
      code: 'core_limit',
      field: 'core',
    });
    expect(refusal(() => assertCompetencyFits(v1, insurance(3), competency))).toBe('saved');
  });

  it('editing one of the four keeps it core; a retired one does not count; a non-core fifth is saved', () => {
    expect(refusal(() => assertCompetencyFits(v1, insurance(4), { ...competency, position: 2 }))).toBe('saved');
    const retiredOne = insurance(4);
    const pack = { ...retiredOne, competencies: retiredOne.competencies.map((c, i) => ({ ...c, retired: i === 0 })) };
    expect(refusal(() => assertCompetencyFits(v1, pack, competency))).toBe('saved');
    expect(refusal(() => assertCompetencyFits(v1, insurance(4), { ...competency, core: [] }))).toBe('saved');
  });

  it('refuses a job type the draft does not offer, and core outside applies-to', () => {
    expect(refusal(() => assertCompetencyFits(v1, insurance(0), { ...competency, appliesTo: ['astronaut'] }))).toEqual({
      code: 'job_type',
      field: 'appliesTo',
    });
    expect(
      refusal(() => assertCompetencyFits(v1, insurance(0), { ...competency, core: ['qa_test_automation'] })),
    ).toEqual({ code: 'core_not_applied', field: 'core' });
  });
});

describe('entry status and what can be removed', () => {
  // Version 1 has 8 packs, each with competencies (catalogue.test.ts).
  const payments = v1.packs[0] as EditorPack;
  const ledger = payments.competencies[0] as EditorPack['competencies'][number];

  it('Live, Changed in draft, New in draft and Retired', () => {
    expect(packStatus(v1, payments)).toBe('live');
    expect(packStatus(v1, { ...payments, label: { en: 'Payments' } })).toBe('changed');
    expect(packStatus(v1, insurance(0))).toBe('new');
    expect(packStatus(v1, { ...payments, retired: true })).toBe('retired');
    expect(competencyStatus(v1, payments.key, ledger)).toBe('live');
    expect(competencyStatus(v1, payments.key, { ...ledger, evidence: 'Other evidence' })).toBe('changed');
    expect(competencyStatus(v1, payments.key, { ...ledger, position: 999 })).toBe('new');
    expect(competencyStatus(v1, payments.key, { ...ledger, retired: true })).toBe('retired');
  });

  it('only an entry new in the draft is removable', () => {
    expect(isNewInDraft(v1, payments.key)).toBe(false);
    expect(isNewInDraft(v1, payments.key, ledger.position)).toBe(false);
    expect(isNewInDraft(v1, payments.key, 999)).toBe(true);
    expect(isNewInDraft(v1, 'insurance')).toBe(true);
  });
});

describe('input schemas', () => {
  it('refuse a reserved or malformed key, and a type or mandatory flag', () => {
    const pack = { version: 2, revision: 0, previousKey: null, key: 'insurance', label: 'Insurance and insurtech' };
    expect(draftPackSchema.safeParse(pack).success).toBe(true);
    for (const key of ['none', 'other', 'Insurance', 'in', '1insurance'])
      expect(draftPackSchema.safeParse({ ...pack, key }).success, key).toBe(false);
    expect(draftCompetencySchema.safeParse(competency).success).toBe(true);
    expect(draftCompetencySchema.safeParse({ ...competency, type: 'mandatory' }).success).toBe(false);
    expect(draftCompetencySchema.safeParse({ ...competency, levelNeeded: 4 }).success).toBe(false);
    expect(draftCompetencySchema.safeParse({ ...competency, appliesTo: [] }).success).toBe(false);
  });
});
