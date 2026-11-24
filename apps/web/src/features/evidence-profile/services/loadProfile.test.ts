import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadProfile } from './loadProfile.ts';

// AIV-P1-043: the profile's read, with the workspace context, jobs, intake and assessment faked; the same reads run
// against PostgreSQL in tests/integration/src/candidate-profile.test.ts. Synthetic cast and ids only.
const JOB = '0190d4a2-0000-7000-9000-000000001031';
const SARA = '0190d4a2-0000-7000-8000-00000000c001';
const ELSEWHERE = '0190d4a2-0000-7000-8000-00000000c0ff';
const VERSION = '0190d4a2-0000-7000-9000-000000000002';
const ctx = { userId: 'u1', workspaceId: '0190d4a2-0000-7000-8000-000000000001', role: 'recruiter', tx: {} };
const fake = vi.hoisted(() => ({
  job: vi.fn(),
  list: vi.fn(),
  ranking: vi.fn(),
  latest: vi.fn(),
  explain: vi.fn(),
}));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (c: typeof ctx) => Promise<unknown>) => ({ value: await fn(ctx) }),
}));
vi.mock('@/server/jobs', () => ({ getJobs: () => ({ getJob: fake.job }) }));
vi.mock('@/server/intake', () => ({ getIntake: () => ({ listApplicationsForJob: fake.list }) }));
vi.mock('@/server/assessment', () => ({
  getAssessment: () => ({ listRanking: fake.ranking, getLatestAssessment: fake.latest, explainRanking: fake.explain }),
}));

const sara = { applicationId: 'a1', personId: SARA, displayName: 'Sara Al Qahtani', stage: 'new' };
const row = { candidateId: SARA, rank: 1, backedScore: 68, upperBound: 84, meetsNeed: 4, competencyCount: 6 };
const competency = (proven: number, claimedLevel: number) => ({ proven: { level: proven }, claimedLevel });
const statements = [{ text: 'Two competencies still rest on claims.', citations: [] }];

const assessed = () => {
  fake.job.mockResolvedValue({ id: JOB, title: 'Senior AI Engineer' });
  fake.list.mockResolvedValue([sara]);
  fake.ranking.mockResolvedValue({
    status: 'ranked',
    rubricVersionId: VERSION,
    rows: [row, { ...row, candidateId: 'p2', rank: 2 }],
  });
  fake.latest.mockResolvedValue({
    rubricVersionId: VERSION,
    competencies: [competency(5, 5), competency(1, 4), competency(0, 4)],
  });
  fake.explain.mockResolvedValue({ resultId: 'r1', source: 'template', statements });
};

afterEach(() => {
  vi.resetAllMocks();
  ctx.role = 'recruiter';
});

describe('loadProfile', () => {
  it("Scenario: Sara's fit: the ranking row, the candidates ranked, her open claims and the explanation", async () => {
    assessed();
    expect(await loadProfile(SARA, JOB)).toEqual({
      jobId: JOB,
      jobTitle: 'Senior AI Engineer',
      name: 'Sara Al Qahtani',
      stage: 'new',
      fit: {
        status: 'scored',
        rank: 1,
        backedScore: 68,
        upperBound: 84,
        meetsNeed: 4,
        competencyCount: 6,
        ranked: 2,
        openClaims: 2,
      },
      explanation: { source: 'template', statements },
    });
    expect(fake.explain).toHaveBeenCalledWith(ctx, SARA, JOB);
  });

  it('Scenario: Candidate not assessed for this job: no approved rubric, and nothing else is read', async () => {
    assessed();
    fake.ranking.mockResolvedValue({ status: 'awaiting_rubric' });
    expect(await loadProfile(SARA, JOB)).toMatchObject({ fit: { status: 'awaiting_rubric' }, explanation: null });
    expect(fake.latest).not.toHaveBeenCalled();
    expect(fake.explain).not.toHaveBeenCalled();
  });

  it('an applicant with no result on the approved rubric version is not yet scored', async () => {
    assessed();
    fake.ranking.mockResolvedValue({ status: 'ranked', rubricVersionId: VERSION, rows: [] });
    expect(await loadProfile(SARA, JOB)).toMatchObject({ fit: { status: 'not_scored' }, explanation: null });
    expect(fake.explain).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed `if (!applicant) return 'notFound'` (reading on with no applicant) -> this test failed (a profile came back, not 'notFound')
  it('Scenario: Another workspace: a candidate who is not an applicant of the job is not found, and no assessment is read', async () => {
    assessed();
    expect(await loadProfile(ELSEWHERE, JOB)).toBe('notFound');
    expect(fake.ranking).not.toHaveBeenCalled();
    expect(fake.latest).not.toHaveBeenCalled();
    expect(fake.explain).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed `if (!found) return ...` after getJob -> this test and both 403 tests below failed (a profile came back)
  it('a job the workspace does not have is not found for an admin or recruiter, and no applicant is read', async () => {
    assessed();
    fake.job.mockResolvedValue(null);
    expect(await loadProfile(SARA, JOB)).toBe('notFound');
    expect(fake.list).not.toHaveBeenCalled();
  });

  it.each(['interviewer', 'hiring_owner'])(
    'a member with role %s not granted the job gets the 403 state, and no applicant is read',
    async (role) => {
      assessed();
      ctx.role = role;
      fake.job.mockResolvedValue(null);
      expect(await loadProfile(SARA, JOB)).toBe('forbidden');
      expect(fake.list).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['not-a-uuid', JOB],
    [SARA, undefined],
    [SARA, "' or 1=1 --"],
  ])('a malformed or missing id (%s, %s) is not found before any read', async (candidateId, jobId) => {
    expect(await loadProfile(candidateId, jobId)).toBe('notFound');
    expect(fake.job).not.toHaveBeenCalled();
  });
});
