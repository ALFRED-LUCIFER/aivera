import { ForbiddenError, type WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it, vi } from 'vitest';
import { IntakeError } from '../domain/application.ts';
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
    findOrCreatePerson: vi.fn(),
    displayNames,
    jobResource: async () => JOB,
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
      findOrCreatePerson: async () => ({ personId: 'p' }),
      displayNames: vi.fn(),
      jobResource: async () => JOB,
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
