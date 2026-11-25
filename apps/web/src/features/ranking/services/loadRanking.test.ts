import { IntakeError } from '@credalent/intake';
import { ForbiddenError } from '@credalent/workspaces';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRanking } from './loadRanking.ts';

// AIV-P1-034: the ranked table's read, with the workspace context, intake, assessment and the rubric read faked.
// Synthetic cast and ids only.
const JOB = '0190d4a2-0000-7000-9000-000000001031';
const VERSION = '0190d4a2-0000-7000-9000-000000000002';
const ctx = { userId: 'u1', workspaceId: '0190d4a2-0000-7000-8000-000000000001', role: 'recruiter', tx: {} };
const fake = vi.hoisted(() => ({
  list: vi.fn(),
  ranking: vi.fn(),
  rubric: vi.fn(),
  detect: vi.fn(async (): Promise<unknown[]> => []),
  preview: vi.fn(),
  jobs: vi.fn(),
  packs: vi.fn(async (): Promise<unknown[]> => []),
}));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (c: typeof ctx) => Promise<unknown>) => ({ value: await fn(ctx) }),
}));
// AIV-P1-036: the `compare` flag is on here, so the role alone decides the bulk actions.
vi.mock('@/server/flags', () => ({ enabledFlags: new Set(['compare']) }));
vi.mock('@/server/intake', () => ({ getIntake: () => ({ listApplicationsForJob: fake.list }) }));
vi.mock('@/server/assessment', () => ({ getAssessment: () => ({ listRanking: fake.ranking }) }));
vi.mock('@/server/decisions', () => ({ getDecisions: () => ({ listPacks: fake.packs }) }));
vi.mock('@/server/jobs', () => ({
  getApprovedRubricReads: () => ({ approvedRubric: fake.rubric }),
  getJobs: () => ({ listJobs: fake.jobs }),
}));
vi.mock('@/server/people', () => ({
  getCandidates: () => ({ detectDuplicates: fake.detect, previewMerge: fake.preview }),
}));

const at = new Date('2026-11-14T08:00:00.000Z');
const sara = { applicationId: 'a1', personId: 'p1', displayName: 'Sara Al Qahtani', stage: 'new', receivedAt: at };
const ranked = {
  candidateId: 'p1',
  rank: 1,
  backedScore: 68,
  upperBound: 84,
  meetsNeed: 4,
  competencyCount: 6,
  confidence: 'High',
  missingCritical: ['c5'],
  gaps: ['c5'],
  assessedAt: at,
};
const rubric = (id: string) => ({ id, competencies: [{ id: 'c5', name: 'Product judgement' }] });

afterEach(() => vi.restoreAllMocks());

describe('loadRanking', () => {
  // SAFETY: mutation check: logged the applicants under the allowlisted `credalent.assessment.ranked` key -> this test failed (the line contained "Sara")
  it('joins the ranking to the applicants by person id, and logs ids and counts, never a name or score', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    fake.list.mockResolvedValue([sara]);
    fake.ranking.mockResolvedValue({ status: 'ranked', rubricVersionId: VERSION, rows: [ranked] });
    fake.rubric.mockResolvedValue(rubric(VERSION));
    const data = await loadRanking(JOB);
    expect(data).toMatchObject({ jobId: JOB, awaitingRubric: false, rows: [{ id: 'a1', score: { rank: 1 } }] });
    expect(data !== 'notFound' && data?.rows[0]?.score?.missing).toEqual(['Product judgement']);
    expect(fake.ranking).toHaveBeenCalledWith(ctx, JOB);
    const lines = write.mock.calls.map(([chunk]) => String(chunk));
    expect(lines.join('')).not.toMatch(/Sara|Product judgement/);
    const logged = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l['msg'] === 'ranking listed');
    expect(logged).toMatchObject({
      jobId: JOB,
      'credalent.intake.applications': 1,
      'credalent.assessment.ranked': 1,
    });
  });

  it('names nothing from a rubric version other than the ranking’s', async () => {
    fake.list.mockResolvedValue([sara]);
    fake.ranking.mockResolvedValue({ status: 'ranked', rubricVersionId: VERSION, rows: [ranked] });
    fake.rubric.mockResolvedValue(rubric('0190d4a2-0000-7000-9000-000000000003'));
    const data = await loadRanking(JOB);
    expect(data !== 'notFound' && data?.rows[0]?.score?.missing).toEqual([]);
  });

  it('a job awaiting its rubric lists every applicant unscored, without reading the rubric', async () => {
    fake.list.mockResolvedValue([sara]);
    fake.ranking.mockResolvedValue({ status: 'awaiting_rubric' });
    fake.rubric.mockClear();
    expect(await loadRanking(JOB)).toEqual({
      jobId: JOB,
      awaitingRubric: true,
      rows: [{ id: 'a1', personId: 'p1', name: 'Sara Al Qahtani', stage: 'new', score: null }],
      bulkActions: ['compare', 'chooseForInterview', 'addToPack'],
      packs: [],
    });
    expect(fake.rubric).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: dropped ForbiddenError from the catch -> this test failed (rejected instead of 'notFound')
  it("a job the member cannot see (intake's or assessment's refusal), or a malformed id, is not found", async () => {
    fake.list.mockRejectedValueOnce(new IntakeError('job_not_found'));
    expect(await loadRanking(JOB)).toBe('notFound');
    fake.list.mockResolvedValue([sara]);
    fake.ranking.mockRejectedValueOnce(new ForbiddenError());
    expect(await loadRanking(JOB)).toBe('notFound');
    fake.list.mockClear();
    expect(await loadRanking('not-a-uuid')).toBe('notFound');
    expect(fake.list).not.toHaveBeenCalled();
  });

  it('a recruiter gets each row’s duplicates: the merged count, and the possible duplicate with what a merge combines (AIV-P1-018)', async () => {
    fake.list.mockResolvedValue([sara]);
    fake.ranking.mockResolvedValue({ status: 'awaiting_rubric' });
    fake.detect.mockResolvedValueOnce([
      {
        personId: 'p1',
        possible: [{ personId: 'p0', displayName: 'Sara Al-Qahtani', reason: 'same_name' }],
        merged: [{ mergeId: 'm1', displayName: 'Sara Al Qahtani', mergedAt: at, automatic: true, undoable: true }],
      },
    ]);
    const side = (personId: string, displayName: string, stage: string) => ({
      personId,
      displayName,
      applications: [{ jobId: JOB, stage, sources: ['linkedin'] }],
      evidenceSources: 1,
    });
    fake.preview.mockResolvedValueOnce({
      survivor: side('p0', 'Sara Al-Qahtani', 'in_process'),
      merged: side('p1', 'Sara Al Qahtani', 'new'),
    });
    fake.jobs.mockResolvedValueOnce([{ id: JOB, title: 'Senior AI Engineer' }]);
    const data = await loadRanking(JOB);
    expect(fake.detect).toHaveBeenCalledWith(ctx, ['p1']);
    expect(fake.preview).toHaveBeenCalledWith(ctx, 'p0', 'p1');
    expect(data !== 'notFound' && data?.rows[0]?.duplicates).toEqual({
      personId: 'p1',
      mergedCount: 1,
      // Undo is for admins; this viewer is a recruiter.
      undo: null,
      possible: {
        personId: 'p0',
        name: 'Sara Al-Qahtani',
        reason: 'same_name',
        survivor: {
          name: 'Sara Al-Qahtani',
          applications: [{ job: 'Senior AI Engineer', stage: 'in_process', sources: ['linkedin'], keepsStage: null }],
          evidenceSources: 1,
        },
        // Both applied to the job: the merged side says the survivor's stage remains.
        merged: {
          name: 'Sara Al Qahtani',
          applications: [{ job: 'Senior AI Engineer', stage: 'new', sources: ['linkedin'], keepsStage: 'in_process' }],
          evidenceSources: 1,
        },
      },
    });
  });

  // SAFETY: mutation check: removed the role check from duplicatesOf -> this test failed (detectDuplicates called)
  // SAFETY: mutation check: passed 'recruiter' instead of ctx.role to bulkActionsFor -> this test failed (bulkActions was ['compare'])
  it('a hiring owner or interviewer is never sent duplicates, nor offered a bulk action (AIV-P1-036)', async () => {
    fake.list.mockResolvedValue([sara]);
    fake.ranking.mockResolvedValue({ status: 'awaiting_rubric' });
    fake.detect.mockClear();
    ctx.role = 'interviewer';
    try {
      const data = await loadRanking(JOB);
      expect(data !== 'notFound' && data?.rows[0]?.duplicates).toBeUndefined();
      expect(data !== 'notFound' && data?.bulkActions).toEqual([]);
      expect(fake.detect).not.toHaveBeenCalled();
    } finally {
      ctx.role = 'recruiter';
    }
  });

  it('offers the undecided packs and marks their members "In shortlist pack" (AIV-P2-010)', async () => {
    fake.list.mockResolvedValue([sara]);
    fake.ranking.mockResolvedValue({ status: 'ranked', rubricVersionId: VERSION, rows: [ranked] });
    fake.rubric.mockResolvedValue(rubric(VERSION));
    fake.packs.mockResolvedValueOnce([
      { id: 'k1', name: 'Round 2 shortlist', status: 'ready', preparedAt: at, candidateIds: ['p1'] },
      { id: 'k0', name: 'Round 1 shortlist', status: 'decided', preparedAt: at, candidateIds: ['p9'] },
    ]);
    const data = await loadRanking(JOB);
    expect(data !== 'notFound' && data?.packs).toEqual([{ id: 'k1', name: 'Round 2 shortlist', candidateIds: ['p1'] }]);
    expect(data !== 'notFound' && data?.rows[0]?.inPack).toBe(true);
    expect(fake.packs).toHaveBeenCalledWith(ctx, JOB);
  });

  // SAFETY: mutation check: read the packs for every role -> this test failed (listPacks called for an interviewer)
  it('a member with no pack action never reads the packs', async () => {
    fake.list.mockResolvedValue([sara]);
    fake.ranking.mockResolvedValue({ status: 'ranked', rubricVersionId: VERSION, rows: [ranked] });
    fake.rubric.mockResolvedValue(rubric(VERSION));
    fake.packs.mockClear();
    ctx.role = 'hiring_owner';
    try {
      const data = await loadRanking(JOB);
      expect(data !== 'notFound' && data?.packs).toBeUndefined();
      expect(fake.packs).not.toHaveBeenCalled();
    } finally {
      ctx.role = 'recruiter';
    }
  });

  it('any other failure reaches the error state', async () => {
    fake.list.mockRejectedValue(new Error('connection lost'));
    await expect(loadRanking(JOB)).rejects.toThrow('connection lost');
  });
});
