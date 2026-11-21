import { describe, expect, it } from 'vitest';
import { CATALOGUE_V1 } from '../infrastructure/catalogue-v1.fixture.ts';
import {
  assertCompetencyFits,
  assertFairCompetency,
  assertFairHint,
  assertFairRegion,
  assertFairStarters,
  CatalogueError,
  competencyStatus,
  draftCompetencySchema,
  draftHintSchema,
  draftJobTypeSchema,
  draftPackSchema,
  draftRegionSchema,
  fairnessRule,
  hintStatus,
  isHintNewInDraft,
  isNewInDraft,
  isRegionNewInDraft,
  jobTypeStatus,
  packStatus,
  placeJobType,
  regionStatus,
  residencyRule,
  retireEntrySchema,
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
  packs: version.packs.map((p) => ({
    ...p,
    competencies: p.competencies.map((c, position) => ({ ...c, position })),
    // A hint's position counts within its region, as the draft stores it.
    hints: p.hints.map((h, i) => ({ ...h, position: p.hints.slice(0, i).filter((o) => o.region === h.region).length })),
  })),
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
    expect(refusal(() => assertCompetencyFits(v1, insurance(4), competency, []))).toEqual({
      code: 'core_limit',
      field: 'core',
    });
    expect(refusal(() => assertCompetencyFits(v1, insurance(3), competency, []))).toBe('saved');
  });

  it('editing one of the four keeps it core; a retired one does not count; a non-core fifth is saved', () => {
    expect(refusal(() => assertCompetencyFits(v1, insurance(4), { ...competency, position: 2 }, []))).toBe('saved');
    const retiredOne = insurance(4);
    const pack = { ...retiredOne, competencies: retiredOne.competencies.map((c, i) => ({ ...c, retired: i === 0 })) };
    expect(refusal(() => assertCompetencyFits(v1, pack, competency, []))).toBe('saved');
    expect(refusal(() => assertCompetencyFits(v1, insurance(4), { ...competency, core: [] }, []))).toBe('saved');
  });

  it('refuses a job type the draft does not offer, and core outside applies-to', () => {
    expect(
      refusal(() => assertCompetencyFits(v1, insurance(0), { ...competency, appliesTo: ['astronaut'] }, [])),
    ).toEqual({
      code: 'job_type',
      field: 'appliesTo',
    });
    expect(
      refusal(() => assertCompetencyFits(v1, insurance(0), { ...competency, core: ['qa_test_automation'] }, [])),
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

// AIV-P2-046: a regional hint is market knowledge shown with evidence, never a residency rule.
const { core: _core, ...hintFields } = competency;
const hint = {
  ...hintFields,
  packKey: 'logistics_mobility',
  region: 'ksa',
  name: 'FASAH customs integration',
  evidence: 'Integration code and tests against FASAH documents',
  levelNeeded: 2 as const,
};

describe('Scenario Outline: A hint is a skill, never a residency rule', () => {
  // SAFETY: mutation check: assertFairHint skipped the residency rules -> the residence visa row failed (fairness_origin)
  it.each([
    ['ZATCA e-invoicing integration', 'saved'],
    ['Must hold a UAE residence visa', { code: 'fairness_residency', field: 'name' }],
    ['Saudi national', { code: 'fairness_origin', field: 'name' }],
    ['Worked at Aramco', { code: 'fairness_employer', field: 'name' }],
  ])('"%s" is %j', (name, result) => {
    expect(refusal(() => assertFairHint({ ...hint, name }))).toEqual(result);
  });

  it.each([
    'Residency in Dubai',
    'Resident of Riyadh',
    'UAE work permit',
    'Employment visa sponsorship',
    'Visa holder in KSA',
    'Holds an iqama',
    'Indian passport',
    'Nationality: Emirati',
    'Lives in Abu Dhabi',
    'Based in Bengaluru',
    'Candidates who are from the Gulf',
    'Must hold a UAE visa',
    'Must have an Emirates ID',
    'Valid Saudi ID required',
    'Aadhaar holder',
    'Transferable sponsorship',
    'Kafala transfer accepted',
  ])('"%s" breaks the residency rule', (text) => {
    expect(residencyRule(text)).toBe(true);
  });

  it.each([
    'ZATCA e-invoicing integration',
    'UAE data residency rules',
    'Emirates ID and UAE PASS sign-in',
    'Visa and Mastercard card payments',
    'Free-zone customs procedures',
    'Reads data from the FASAH platform',
    'Handles messages that are from ZATCA',
    'Data-residency controls for cloud workloads',
    'Tax residency certificate integration',
    'Aadhaar authentication',
  ])('the near-miss "%s" passes', (text) => {
    expect(residencyRule(text)).toBe(false);
  });

  it('checks the meaning too, and finds nothing in version 1 hints', () => {
    expect(refusal(() => assertFairHint({ ...hint, meaning: 'For engineers living in Jeddah.' }))).toEqual({
      code: 'fairness_residency',
      field: 'meaning',
    });
    const texts = CATALOGUE_V1.packs.flatMap((p) => p.hints.flatMap((h) => [h.name, h.meaning]));
    expect(texts.length).toBeGreaterThan(80);
    expect(texts.filter((t) => residencyRule(t))).toEqual([]);
  });
});

describe('Scenario: A hint cannot be made mandatory', () => {
  // SAFETY: mutation check: built draftHintSchema with .strip() instead of strict -> this test failed (type accepted)
  it('the hint schema refuses a type, core, a bad region and level 4', () => {
    const input = hint;
    expect(draftHintSchema.safeParse(input).success).toBe(true);
    expect(draftHintSchema.safeParse({ ...input, type: 'mandatory' }).success).toBe(false);
    expect(draftHintSchema.safeParse({ ...input, core: [] }).success).toBe(false);
    expect(draftHintSchema.safeParse({ ...input, region: 'KSA' }).success).toBe(false);
    expect(draftHintSchema.safeParse({ ...input, levelNeeded: 4 }).success).toBe(false);
    expect(retireEntrySchema.safeParse({ ...hint, entry: 'regionalHint', position: 0 }).success).toBe(false);
    expect(
      retireEntrySchema.safeParse({
        version: 2,
        revision: 0,
        entry: 'regionalHint',
        packKey: 'logistics_mobility',
        region: 'ksa',
        position: 0,
      }).success,
    ).toBe(true);
  });
});

describe('hint status and what can be removed', () => {
  const logistics = v1.packs.find((p) => p.key === 'logistics_mobility') as EditorPack;
  const fasah = logistics.hints.find((h) => h.region === 'ksa') as EditorPack['hints'][number];

  it('Live, Changed in draft, New in draft and Retired; only a new hint is removable', () => {
    expect(hintStatus(v1, logistics.key, fasah)).toBe('live');
    expect(hintStatus(v1, logistics.key, { ...fasah, evidence: 'Other evidence' })).toBe('changed');
    expect(hintStatus(v1, logistics.key, { ...fasah, position: 9 })).toBe('new');
    expect(hintStatus(v1, logistics.key, { ...fasah, region: 'uae', position: 9 })).toBe('new');
    expect(hintStatus(v1, logistics.key, { ...fasah, retired: true })).toBe('retired');
    expect(isHintNewInDraft(v1, logistics.key, 'ksa', fasah.position)).toBe(false);
    expect(isHintNewInDraft(v1, logistics.key, 'ksa', 9)).toBe(true);
  });

  // SAFETY: mutation check: assertCompetencyFits ignored `kept` -> this test failed (job_type)
  it('a retired job type the hint already had stays on it; a new hint cannot take it', () => {
    const retiredSwe = {
      ...v1,
      jobTypes: v1.jobTypes.map((t) => ({ ...t, retired: t.key === 'software_engineering' })),
    };
    const input = { ...hint, position: fasah.position, core: [] };
    expect(refusal(() => assertCompetencyFits(retiredSwe, logistics, input, ['software_engineering']))).toBe('saved');
    expect(refusal(() => assertCompetencyFits(retiredSwe, logistics, input, []))).toEqual({
      code: 'job_type',
      field: 'appliesTo',
    });
  });
});

// AIV-P2-047: job types in a draft.
const refused = (starters: string[]) => refusal(() => assertFairStarters(starters));
describe('Feature: Edit job types in a catalogue draft', () => {
  const security = {
    version: 2,
    revision: 4,
    adding: true,
    key: 'security_engineering',
    label: 'Security engineering',
    evidence: 'Threat models, security reviews, fixed vulnerabilities',
    starters: ['Threat modelling', 'Secure code review', 'Incident response', 'Identity and access'],
    position: 2,
  };

  it('Scenario: A job type needs exactly four starters, each filled in', () => {
    expect(draftJobTypeSchema.safeParse(security).success).toBe(true);
    for (const starters of [security.starters.slice(0, 3), [...security.starters, 'Fuzzing'], ['a', 'b', 'c', ' ']])
      expect(draftJobTypeSchema.safeParse({ ...security, starters }).error?.issues[0]?.path[0]).toBe('starters');
  });

  it('Scenario Outline: Keys are checked: format and reserved keys', () => {
    for (const key of ['Security Engineering', 'security-engineering', 'none', 'se'])
      expect(draftJobTypeSchema.safeParse({ ...security, key }).error?.issues[0]?.path[0], key).toBe('key');
  });

  it('Scenario: Starter competencies follow the fairness rule', () => {
    expect(refused([...security.starters.slice(0, 3), 'Ex-Big Four experience'])).toEqual({
      code: 'fairness_employer',
      field: 'starters',
    });
    expect(refused(['Saudi nationals', 'b', 'c', 'd'])).toEqual({ code: 'fairness_origin', field: 'starters' });
    expect(refused(security.starters)).toBe('saved');
    // Version 1's starters all pass.
    for (const t of CATALOGUE_V1.jobTypes) expect(refused([...t.starterCompetencies]), t.key).toBe('saved');
  });

  it('position ordering: before the offered job type at that place, or last; retired ones keep their place', () => {
    const types = ['a', 'b', 'c', 'd'].map((key) => ({
      ...(CATALOGUE_V1.jobTypes[0] as (typeof CATALOGUE_V1.jobTypes)[number]),
      key,
      retired: key === 'b',
    }));
    expect(placeJobType(types, 'new', 0)).toEqual(['new', 'a', 'b', 'c', 'd']);
    // Offered: a, c, d. Position 1 is before c.
    expect(placeJobType(types, 'new', 1)).toEqual(['a', 'b', 'new', 'c', 'd']);
    expect(placeJobType(types, 'new', 9)).toEqual(['a', 'b', 'c', 'd', 'new']);
    // Moving an existing one: d to first.
    expect(placeJobType(types, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('job type status: Live, Changed in draft, New in draft, Retired', () => {
    const swe = v1.jobTypes[0] as (typeof v1.jobTypes)[number];
    expect(jobTypeStatus(v1, swe)).toBe('live');
    expect(jobTypeStatus(v1, { ...swe, starterCompetencies: ['a', 'b', 'c', 'd'] })).toBe('changed');
    expect(jobTypeStatus(v1, { ...swe, key: 'security_engineering' })).toBe('new');
    expect(jobTypeStatus(v1, { ...swe, retired: true })).toBe('retired');
  });
});

// AIV-P2-059: regions in a draft. A region is a market, never where someone lives or is from (ADR-013 points 11, 16).
const regionInput = (key: string, label: string) => ({ version: 2, revision: 4, previousKey: null, key, label });
const save = (key: string, label: string) => {
  const parsed = draftRegionSchema.safeParse(regionInput(key, label));
  if (!parsed.success) return { invalid: parsed.error.issues[0]?.path[0] };
  return refusal(() => assertFairRegion(parsed.data));
};
describe('Feature: Add and retire regions in a catalogue draft', () => {
  // SAFETY: mutation check: assertFairRegion returned without checking -> the "UAE residents" row failed (saved)
  it.each([
    ['gcc', 'GCC', 'saved'],
    ['eu', 'EU', 'saved'],
    ['uk', 'United Kingdom', 'saved'],
    ['EU', 'EU', { invalid: 'key' }],
    ['other', 'Other', { invalid: 'key' }],
    ['eu', ' ', { invalid: 'label' }],
    ['uae_r', 'UAE residents', { code: 'fairness_region', field: 'label' }],
    ['ksa_residents', 'KSA', { code: 'fairness_region', field: 'key' }],
    ['india', 'Indian nationals', { code: 'fairness_region', field: 'label' }],
    ['ex_aramco', 'Aramco', { code: 'fairness_region', field: 'label' }],
  ])('key "%s" with label "%s" is %j', (key, label, result) => {
    expect(save(key, label)).toEqual(result);
  });

  it('version 1 regions pass the fairness rule', () => {
    for (const r of CATALOGUE_V1.regions) expect(save(r.key, r.label.en), r.key).toBe('saved');
  });

  it('a region is retired or removed through the retire schema; a hint may name a two-letter region', () => {
    expect(retireEntrySchema.safeParse({ version: 2, revision: 4, entry: 'region', regionKey: 'eu' }).success).toBe(
      true,
    );
    expect(draftHintSchema.shape.region.safeParse('eu').success).toBe(true);
  });

  it('region status: Live, Changed in draft, New in draft, Retired; only a new region is new in the draft', () => {
    const india = v1.regions.find((r) => r.key === 'india') as (typeof v1.regions)[number];
    expect(regionStatus(v1, india)).toBe('live');
    expect(regionStatus(v1, { ...india, label: { en: 'Republic of India' } })).toBe('changed');
    expect(regionStatus(v1, { key: 'eu', label: { en: 'EU' }, retired: false })).toBe('new');
    expect(regionStatus(v1, { ...india, retired: true })).toBe('retired');
    expect(isRegionNewInDraft(v1, 'eu')).toBe(true);
    expect(isRegionNewInDraft(v1, 'ksa')).toBe(false);
  });
});
