import { ForbiddenError, type WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it, vi } from 'vitest';
import { IntakeError } from '../domain/application.ts';
import type { Application } from '../domain/application.ts';
import { applicationUseCases, type IntakeStore, type Ports, type ReceiveBatchInput } from './applications.ts';

// AIV-P1-086: listApplicationsForJob over faked ports. With the real modules the jobs module's row-level security
// already hides an ungranted job (tests/integration/src/intake.test.ts), and every role that can see a job also holds
// candidate.view, so intake's own authorize can only be shown to matter here. Synthetic cast and opaque ids only.
const JOB = { jobId: '0190d4a2-0000-7000-9000-000000001031', clientId: null };
const ctx = { workspaceId: 'w1', role: 'hiring_owner', tx: {} } as WorkspaceContext;
const at = new Date('2026-11-14T08:00:00.000Z');

function setup(authorize: Ports['authorize']) {
  const listForJob = vi.fn<IntakeStore['listForJob']>(async () => [
    { applicationId: 'a2', personId: 'p2', stage: 'new', receivedAt: at, source: 'email' },
    { applicationId: 'a1', personId: 'p1', stage: 'new', receivedAt: at, source: 'linkedin' },
  ]);
  const displayNames = vi.fn<Ports['displayNames']>(async () => [{ id: 'p1', displayName: 'Sara Al Qahtani' }]);
  const useCases = applicationUseCases({
    storeFor: () => ({ listForJob }) as unknown as IntakeStore,
    publishApplicationReceived: vi.fn(),
    authorize,
    auditBatchConfirmed: vi.fn(),
    auditStageChanged: vi.fn(),
    findOrCreatePerson: vi.fn(),
    displayNames,
    jobResource: async () => JOB,
    isSyntheticWorkspace: async () => false,
    newId: () => 'id',
    now: () => at,
  });
  return { useCases, listForJob, displayNames };
}

describe('listApplicationsForJob', () => {
  // SAFETY: mutation check: removed authorize(ctx, 'candidate.view', job) from listApplicationsForJob -> this test failed (resolved with both rows, names read)
  it('a refused candidate.view on the job reads no application and no name', async () => {
    const { useCases, listForJob, displayNames } = setup(async () => {
      throw new ForbiddenError();
    });
    await expect(useCases.listApplicationsForJob(ctx, JOB.jobId)).rejects.toThrow(ForbiddenError);
    expect(listForJob).not.toHaveBeenCalled();
    expect(displayNames).not.toHaveBeenCalled();
  });

  it("asks the names read for that job's applicants only, and keeps a person with no name as null", async () => {
    const authorize = vi.fn<Ports['authorize']>(async () => undefined);
    const { useCases, displayNames } = setup(authorize);
    expect(await useCases.listApplicationsForJob(ctx, JOB.jobId)).toEqual([
      { applicationId: 'a2', personId: 'p2', displayName: null, stage: 'new', receivedAt: at, source: 'email' },
      {
        applicationId: 'a1',
        personId: 'p1',
        displayName: 'Sara Al Qahtani',
        stage: 'new',
        receivedAt: at,
        source: 'linkedin',
      },
    ]);
    expect(authorize).toHaveBeenCalledWith(ctx, 'candidate.view', JOB);
    expect(displayNames).toHaveBeenCalledWith(ctx.tx, 'w1', ['p2', 'p1']);
  });
});

// AIV-P1-104: the batch command over faked ports; the stored rows, RLS and audit are in tests/integration/src/intake.test.ts.
describe('receiveBatch', () => {
  const calls: string[] = [];
  const insertBatch = vi.fn<IntakeStore['insertBatch']>(async () => void calls.push('batch'));
  const batchCtx = { workspaceId: 'w1', userId: 'u1', role: 'recruiter', tx: {} } as WorkspaceContext;
  const input: ReceiveBatchInput = {
    jobId: JOB.jobId,
    rightToProcessConfirmed: true,
    wordingKey: 'import.rightToProcess.v1',
    arrivals: [1, 2, 3].map((n) => ({
      person: { displayName: 'Unnamed applicant', synthetic: true, identifiers: [{ type: 'cv_hash', value: `${n}` }] },
      source: 'linkedin',
      fileIds: [],
    })),
  };
  const setupBatch = () => {
    calls.length = 0;
    const auditBatchConfirmed = vi.fn<Ports['auditBatchConfirmed']>(async () => void calls.push('audit'));
    const useCases = applicationUseCases({
      storeFor: () =>
        ({
          insertBatch,
          insertOrGetApplication: async (a: { id: string }) => a,
          insertSource: async () => void calls.push('source'),
        }) as unknown as IntakeStore,
      publishApplicationReceived: vi.fn(async () => void calls.push('outbox')),
      authorize: async () => undefined,
      auditBatchConfirmed,
      auditStageChanged: vi.fn(),
      findOrCreatePerson: async () => ({ personId: 'p' }),
      displayNames: vi.fn(),
      jobResource: async () => JOB,
      isSyntheticWorkspace: async () => false,
      newId: () => `id${calls.length}`,
      now: () => at,
    });
    return { useCases, auditBatchConfirmed };
  };

  it('records one batch for the people, receives each under it, and audits last with the version and count', async () => {
    const { useCases, auditBatchConfirmed } = setupBatch();
    const { applications } = await useCases.receiveBatch(batchCtx, input);
    expect(applications).toHaveLength(3);
    expect(calls).toEqual(['batch', ...[1, 2, 3].flatMap(() => ['source', 'outbox']), 'audit']);
    expect(auditBatchConfirmed).toHaveBeenCalledWith(
      batchCtx,
      expect.objectContaining({
        jobId: JOB.jobId,
        confirmedBy: 'u1',
        wordingVersion: 'v1',
        cvs: 3,
        confirmedAt: at,
      }),
    );
  });

  // SAFETY: mutation check: removed the rightToProcessConfirmed check from receiveBatch -> this test failed (a batch and three applications were written)
  it.each([false, undefined, 'true'])('refuses confirmation %s, writing nothing', async (value) => {
    const { useCases } = setupBatch();
    await expect(
      useCases.receiveBatch(batchCtx, { ...input, rightToProcessConfirmed: value as never }),
    ).rejects.toMatchObject({ code: 'confirmation_required' });
    expect(calls).toEqual([]);
  });

  it('reads the version from the key, and refuses a key that is not a confirmation wording', async () => {
    const { useCases, auditBatchConfirmed } = setupBatch();
    await useCases.receiveBatch(batchCtx, { ...input, wordingKey: 'import.rightToProcess.v2' });
    expect(auditBatchConfirmed).toHaveBeenCalledWith(batchCtx, expect.objectContaining({ wordingVersion: 'v2' }));
    await expect(useCases.receiveBatch(batchCtx, { ...input, wordingKey: 'import.title' })).rejects.toThrow(
      IntakeError,
    );
  });
});

// AIV-P1-114: choosing for interview over faked ports; the stored rows, the rollback and RLS are in
// tests/integration/src/choose-for-interview.test.ts. Synthetic cast, opaque ids.
const OTHER_JOB = '0190d4a2-0000-7000-9000-000000001032';
const id = (n: number) => `0190d4a2-0000-7000-9000-00000000200${n}`;
const recruiter = { workspaceId: 'w1', userId: 'u1', role: 'recruiter', tx: {} } as WorkspaceContext;
const app = (n: number, stage: Application['stage'] = 'assessing', jobId = JOB.jobId): Application => ({
  id: id(n),
  workspaceId: 'w1',
  personId: `p${n}`,
  jobId,
  stage,
  receivedAt: at,
  submittedToClientAt: null,
});

function setupChoose(stored: Application[], authorize: Ports['authorize'] = async () => undefined) {
  const calls: string[] = [];
  const moveStage = vi.fn<IntakeStore['moveStage']>(async (_w, applicationId) => {
    calls.push(`stage:${applicationId}`);
    return true;
  });
  const createInterview = vi.fn(async (_ctx: WorkspaceContext, input: { applicationId: string }) => {
    calls.push(`interview:${input.applicationId}`);
    return { interviewId: `i-${input.applicationId}` };
  });
  const auditStageChanged = vi.fn<Ports['auditStageChanged']>(async (_ctx, change) => {
    calls.push(`audit:${change.applicationId}`);
  });
  const publishApplicationReceived = vi.fn();
  const useCases = applicationUseCases({
    storeFor: () =>
      ({
        findApplication: async (_w: string, applicationId: string) =>
          stored.find((a) => a.id === applicationId) ?? null,
        moveStage,
      }) as unknown as IntakeStore,
    publishApplicationReceived,
    authorize,
    auditBatchConfirmed: vi.fn(),
    auditStageChanged,
    interviews: { createInterview, interviewGaps: async (_ctx, personId) => [`gap-of-${personId}`] },
    findOrCreatePerson: vi.fn(),
    displayNames: vi.fn(),
    jobResource: async (_ctx, jobId) => (jobId === JOB.jobId ? JOB : null),
    isSyntheticWorkspace: async () => false,
    newId: () => 'id',
    now: () => at,
  });
  return { useCases, calls, moveStage, createInterview, auditStageChanged, publishApplicationReceived };
}

describe('chooseForInterview', () => {
  it('moves each to interview with a Round 1 interview, the member as interviewer and their gaps, and audits last', async () => {
    const { useCases, calls, createInterview, auditStageChanged, publishApplicationReceived } = setupChoose([
      app(1),
      app(2, 'new'),
    ]);
    const result = await useCases.chooseForInterview(recruiter, {
      jobId: JOB.jobId,
      applicationIds: [id(1), id(2)],
      reason: '  First shortlist ',
    });
    expect(result).toEqual({
      chosen: [
        { applicationId: id(1), interviewId: `i-${id(1)}` },
        { applicationId: id(2), interviewId: `i-${id(2)}` },
      ],
      skipped: [],
    });
    expect(createInterview).toHaveBeenCalledWith(recruiter, {
      applicationId: id(1),
      round: 'structured_screen',
      interviewerUserId: 'u1',
      competencyIds: ['gap-of-p1'],
    });
    // SAFETY: mutation check: audited before createInterview -> this test failed (order)
    expect(calls).toEqual([
      `stage:${id(1)}`,
      `interview:${id(1)}`,
      `stage:${id(2)}`,
      `interview:${id(2)}`,
      `audit:${id(1)}`,
      `audit:${id(2)}`,
    ]);
    expect(auditStageChanged).toHaveBeenCalledWith(recruiter, {
      applicationId: id(1),
      jobId: JOB.jobId,
      from: 'assessing',
      to: 'interview',
      interviewId: `i-${id(1)}`,
      reason: 'First shortlist',
    });
    // Nobody is contacted: no outbox event leaves intake.
    expect(publishApplicationReceived).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed `application.stage === 'interview' ||` from the skip -> this test failed (a second interview for id(1))
  it('skips someone already chosen: no stage change, interview or audit for them', async () => {
    const { useCases, createInterview, auditStageChanged } = setupChoose([app(1, 'interview'), app(2)]);
    const result = await useCases.chooseForInterview(recruiter, {
      jobId: JOB.jobId,
      applicationIds: [id(1), id(2)],
      reason: 'First shortlist',
    });
    expect(result).toEqual({ chosen: [{ applicationId: id(2), interviewId: `i-${id(2)}` }], skipped: [id(1)] });
    expect(createInterview).toHaveBeenCalledTimes(1);
    expect(auditStageChanged).toHaveBeenCalledTimes(1);
  });

  it('skips someone a concurrent choice moved first', async () => {
    const { useCases, moveStage, createInterview } = setupChoose([app(1)]);
    moveStage.mockResolvedValueOnce(false);
    const result = await useCases.chooseForInterview(recruiter, {
      jobId: JOB.jobId,
      applicationIds: [id(1)],
      reason: 'First shortlist',
    });
    expect(result).toEqual({ chosen: [], skipped: [id(1)] });
    expect(createInterview).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed the `application?.jobId !== job.jobId` check -> this test failed (resolved, id(2) moved)
  it('refuses the whole choice when one application is of another job, writing nothing', async () => {
    const { useCases, calls } = setupChoose([app(1), app(2, 'assessing', OTHER_JOB)]);
    await expect(
      useCases.chooseForInterview(recruiter, {
        jobId: JOB.jobId,
        applicationIds: [id(1), id(2)],
        reason: 'First shortlist',
      }),
    ).rejects.toMatchObject({ code: 'not_on_job', message: 'This candidate has not applied to this job' });
    expect(calls).toEqual([]);
  });

  it('refuses an unknown application and a job the member cannot see', async () => {
    const { useCases, calls } = setupChoose([app(1)]);
    await expect(
      useCases.chooseForInterview(recruiter, { jobId: JOB.jobId, applicationIds: [id(9)], reason: 'x' }),
    ).rejects.toMatchObject({ code: 'not_on_job' });
    await expect(
      useCases.chooseForInterview(recruiter, { jobId: OTHER_JOB, applicationIds: [id(1)], reason: 'x' }),
    ).rejects.toMatchObject({ code: 'job_not_found' });
    expect(calls).toEqual([]);
  });

  it.each(['', '   ', 'x'.repeat(501)])('refuses the reason %j, writing nothing', async (reason) => {
    const { useCases, calls } = setupChoose([app(1)]);
    await expect(
      useCases.chooseForInterview(recruiter, { jobId: JOB.jobId, applicationIds: [id(1)], reason }),
    ).rejects.toMatchObject({ code: 'reason_required', message: 'Give a reason for this choice' });
    expect(calls).toEqual([]);
  });

  // SAFETY: mutation check: removed authorize(ctx, 'interview.schedule', job) from chooseForInterview -> this test failed (resolved, id(1) moved)
  it('authorises interview.schedule on the job before anything is written', async () => {
    const authorize = vi.fn<Ports['authorize']>(async () => {
      throw new ForbiddenError();
    });
    const { useCases, calls } = setupChoose([app(1)], authorize);
    await expect(
      useCases.chooseForInterview(recruiter, { jobId: JOB.jobId, applicationIds: [id(1)], reason: 'x' }),
    ).rejects.toThrow(ForbiddenError);
    expect(authorize).toHaveBeenCalledWith(recruiter, 'interview.schedule', JOB);
    expect(calls).toEqual([]);
  });
});
