import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCompare } from './loadCompare.ts';

// AIV-P1-047: the comparison's read, with the workspace context, jobs, intake, assessment and evidence faked; the page
// runs against PostgreSQL in tests/e2e/src/compare.spec.ts. Synthetic cast and ids only.
const JOB = '0190d4a2-0000-7000-9000-000000001031';
const SARA = '0190d4a2-0000-7000-8000-00000000c001';
const LAYLA = '0190d4a2-0000-7000-8000-00000000c003';
const NEW = '0190d4a2-0000-7000-8000-00000000c009';
const ELSEWHERE = '0190d4a2-0000-7000-8000-00000000c0ff';
const VERSION = '0190d4a2-0000-7000-9000-000000000002';
const ctx = { userId: 'u1', workspaceId: '0190d4a2-0000-7000-8000-000000000001', role: 'recruiter', tx: {} };
const fake = vi.hoisted(() => ({
  job: vi.fn(),
  list: vi.fn(),
  ranking: vi.fn(),
  latest: vi.fn(),
  rubric: vi.fn(),
  numbered: vi.fn(),
  evidence: vi.fn(),
}));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (c: typeof ctx) => Promise<unknown>) => ({ value: await fn(ctx) }),
}));
vi.mock('@/server/jobs', () => ({
  getJobs: () => ({ getJob: fake.job, getApprovedRubric: fake.numbered }),
  getApprovedRubricReads: () => ({ approvedRubric: fake.rubric }),
}));
vi.mock('@/server/evidence', () => ({ getEvidence: () => ({ listEvidenceForCandidate: fake.evidence }) }));
vi.mock('@/server/intake', () => ({ getIntake: () => ({ listApplicationsForJob: fake.list }) }));
vi.mock('@/server/assessment', () => ({
  getAssessment: () => ({ listRanking: fake.ranking, getLatestAssessment: fake.latest }),
}));

const applicant = (personId: string, applicationId: string, displayName: string) => ({
  applicationId,
  personId,
  displayName,
  stage: 'new',
});
const result = (competencyId: string, proven: number, itemIds: string[], claimItemIds: string[] = []) => ({
  competencyId,
  weightPercent: competencyId === 'llm' ? 25 : 10,
  levelNeeded: competencyId === 'llm' ? 4 : 2,
  proven: { level: proven, itemIds },
  claimedLevel: proven,
  claimItemIds,
});
const item = (id: string, excerpt: string, strength: string, provenance: string) => ({
  id,
  excerpt,
  excerptSpan: null,
  strength,
  provenance,
  limit: 'Shows the tooling only.',
  source: {
    id: `s-${id}`,
    kind: 'repository',
    label: id,
    url: null,
    blobFileId: 'f1',
    checkedAt: null,
    checkMethod: null,
  },
});
const RESULTS: Record<string, unknown[]> = {
  [SARA]: [result('llm', 5, ['i1']), result('arabic', 0, [], ['i2'])],
  [LAYLA]: [result('llm', 3, ['i3']), result('arabic', 5, ['i4'])],
};
const EVIDENCE: Record<string, unknown[]> = {
  [SARA]: [
    item('i1', 'Merchant assistant, about 9,000 merchants.', 'strong', 'corroborated'),
    item('i2', 'Describes a Gulf Arabic evaluation set.', 'supporting', 'claim'),
  ],
  [LAYLA]: [
    item('i3', 'Support search prototype with 300 pilot users.', 'medium', 'submitted'),
    item('i4', 'Arabic OCR pipeline, public and documented.', 'strong', 'corroborated'),
  ],
};

const assessed = () => {
  fake.job.mockResolvedValue({ id: JOB, title: 'Senior AI Engineer' });
  fake.list.mockResolvedValue([
    applicant(SARA, 'a1', 'Sara Al Qahtani'),
    applicant(LAYLA, 'a3', 'Layla Haddad'),
    applicant(NEW, 'a9', 'Huda Rahman'),
  ]);
  fake.ranking.mockResolvedValue({
    status: 'ranked',
    rubricVersionId: VERSION,
    rows: [
      { candidateId: SARA, rank: 1, backedScore: 68, upperBound: 84 },
      { candidateId: LAYLA, rank: 3, backedScore: 61, upperBound: 82 },
    ],
  });
  fake.latest.mockImplementation(async (_ctx, id: string) => ({ rubricVersionId: VERSION, competencies: RESULTS[id] }));
  fake.evidence.mockImplementation(async (_ctx, id: string) => EVIDENCE[id]);
  fake.rubric.mockResolvedValue({
    id: VERSION,
    competencies: [
      { id: 'arabic', name: 'Arabic and bilingual NLP', weightPercent: 10, levelNeeded: 2 },
      { id: 'llm', name: 'LLM systems in production', weightPercent: 25, levelNeeded: 4 },
    ],
  });
  fake.numbered.mockResolvedValue({ id: VERSION, version: 2 });
};

afterEach(() => {
  vi.resetAllMocks();
  ctx.role = 'recruiter';
});

describe('loadCompare', () => {
  it('Scenario: the candidates in the order ticked, on the rubric’s competencies heaviest first', async () => {
    assessed();
    expect(await loadCompare(JOB, `${SARA},${LAYLA}`)).toEqual({
      status: 'ready',
      jobId: JOB,
      jobTitle: 'Senior AI Engineer',
      selectionHref: `/app/jobs/${JOB}/candidates?selected=a1,a3`,
      rubricVersion: 2,
      rows: [
        { competencyId: 'llm', name: 'LLM systems in production', weightPercent: 25, needed: 4 },
        { competencyId: 'arabic', name: 'Arabic and bilingual NLP', weightPercent: 10, needed: 2 },
      ],
      columns: [
        {
          candidateId: SARA,
          name: 'Sara Al Qahtani',
          score: { backed: 68, upTo: 84 },
          cells: {
            llm: {
              proven: 5,
              lead: { strength: 'strong', provenance: 'corroborated' },
              claimOnly: false,
              summary: 'Merchant assistant, about 9,000 merchants.',
            },
            // A claim: proven 0 and marked claim-only, whatever strength it is stored with (AGENTS.md 1.6).
            arabic: {
              proven: 0,
              lead: { strength: 'supporting', provenance: 'claim' },
              claimOnly: true,
              summary: 'Describes a Gulf Arabic evaluation set.',
            },
          },
        },
        {
          candidateId: LAYLA,
          name: 'Layla Haddad',
          score: { backed: 61, upTo: 82 },
          cells: {
            llm: {
              proven: 3,
              lead: { strength: 'medium', provenance: 'submitted' },
              claimOnly: false,
              summary: 'Support search prototype with 300 pilot users.',
            },
            arabic: {
              proven: 5,
              lead: { strength: 'strong', provenance: 'corroborated' },
              claimOnly: false,
              summary: 'Arabic OCR pipeline, public and documented.',
            },
          },
        },
      ],
    });
  });

  it('keeps a ticked candidate who is not scored yet, with no score and no cell', async () => {
    assessed();
    const compare = await loadCompare(JOB, `${SARA},${NEW}`);
    expect(compare).toMatchObject({ status: 'ready' });
    expect(compare && typeof compare === 'object' && 'columns' in compare && compare.columns[1]).toEqual({
      candidateId: NEW,
      name: 'Huda Rahman',
      score: null,
      cells: {},
    });
    expect(fake.latest).toHaveBeenCalledTimes(1);
  });

  // SAFETY: mutation check: removed the notOnJob return from loadCompare -> this test failed (the ranking was read)
  it('Scenario: Candidates from another job: no comparison, and nothing about anyone is read', async () => {
    assessed();
    expect(await loadCompare(JOB, `${SARA},${ELSEWHERE}`)).toEqual({
      status: 'notOnJob',
      jobId: JOB,
      jobTitle: 'Senior AI Engineer',
      selectionHref: `/app/jobs/${JOB}/candidates?selected=a1`,
    });
    for (const read of [fake.ranking, fake.latest, fake.evidence, fake.rubric]) expect(read).not.toHaveBeenCalled();
  });

  it('Scenario: One candidate: asks for more, keeping the one ticked', async () => {
    assessed();
    expect(await loadCompare(JOB, SARA)).toMatchObject({
      status: 'tooFew',
      selectionHref: `/app/jobs/${JOB}/candidates?selected=a1`,
    });
    expect(await loadCompare(JOB, undefined)).toMatchObject({ status: 'tooFew' });
    expect(fake.ranking).not.toHaveBeenCalled();
  });

  it('shows nothing to compare before a rubric version is approved', async () => {
    assessed();
    fake.ranking.mockResolvedValue({ status: 'awaiting_rubric' });
    expect(await loadCompare(JOB, `${SARA},${LAYLA}`)).toMatchObject({
      status: 'ready',
      rubricVersion: null,
      rows: [],
      columns: [
        { candidateId: SARA, score: null, cells: {} },
        { candidateId: LAYLA, score: null, cells: {} },
      ],
    });
    expect(fake.rubric).not.toHaveBeenCalled();
  });

  it('is not found for a malformed job id or id list, before any read', async () => {
    expect(await loadCompare('senior-ai-engineer', SARA)).toBe('notFound');
    expect(await loadCompare(JOB, 'sara,layla')).toBe('notFound');
    expect(fake.job).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: read the applicants before the job check -> this test failed (intake was called)
  it('is forbidden for a hiring owner not granted the job, and not found for a recruiter, reading nothing more', async () => {
    fake.job.mockResolvedValue(null);
    expect(await loadCompare(JOB, `${SARA},${LAYLA}`)).toBe('notFound');
    ctx.role = 'hiring_owner';
    expect(await loadCompare(JOB, `${SARA},${LAYLA}`)).toBe('forbidden');
    expect(fake.list).not.toHaveBeenCalled();
  });
});
