import { IntakeError } from '@credalent/intake';
import { ForbiddenError, type WorkspaceContext } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addApplicants } from './addApplicants.ts';

// AIV-P1-019: the action's own gate, with the workspace context, files and intake faked. Synthetic opaque ids only.
const W1 = '0190d4a2-0000-7000-8000-000000000001';
const JOB = '0190d4a2-0000-7000-9000-000000001031';
const F1 = '0190d4a2-0000-7000-8000-0000000000f1';
const SHA = 'a'.repeat(64);
const ctx = { userId: 'u1', workspaceId: W1, role: 'interviewer', status: 'active', tx: {} } as WorkspaceContext;

const fake = vi.hoisted(() => ({
  authorize: vi.fn(),
  findCleanUpload: vi.fn(),
  receiveBatch: vi.fn(),
}));
vi.mock('@credalent/observability', () => ({
  annotateSpan: vi.fn(),
  log: { warn: vi.fn() },
  withSpan: (_: string, fn: () => unknown) => fn(),
}));
vi.mock('@/server/auth', () => ({ getSessionUserId: async () => 'u1', getIdentity: () => ({}) }));
vi.mock('@/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@credalent/audit/composition', () => ({ createAudit: () => ({}) }));
vi.mock('@credalent/workspaces/composition', () => ({
  createWorkspaces: () => ({
    activeWorkspace: async () => W1,
    withWorkspace: (_s: unknown, _w: string, fn: (c: WorkspaceContext) => unknown) => fn(ctx),
    authorize: fake.authorize,
    getWorkspace: async () => ({ synthetic: true }),
  }),
}));
vi.mock('@/server/files', () => ({ getFiles: () => ({ files: { findCleanUpload: fake.findCleanUpload } }) }));
vi.mock('@/server/intake', () => ({ getIntake: () => ({ receiveBatch: fake.receiveBatch }) }));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
}));

const input = { jobId: JOB, rightToProcessConfirmed: true as const, source: 'linkedin' as const, fileIds: [F1] };

beforeEach(() => {
  vi.resetAllMocks();
  fake.authorize.mockResolvedValue(undefined);
  fake.findCleanUpload.mockResolvedValue({ purpose: 'cv', sha256: SHA });
  fake.receiveBatch.mockResolvedValue({
    batchId: 'b1',
    applications: [{ applicationId: 'a1', personId: 'p1', sourceId: 's1', created: true }],
  });
});

describe('addApplicants', () => {
  it('files a clean CV as a synthetic unnamed applicant in a synthetic workspace', async () => {
    expect(await addApplicants(input)).toEqual({ ok: true, applications: [{ applicationId: 'a1', created: true }] });
    expect(fake.authorize).toHaveBeenCalledWith(ctx, 'candidate.create', undefined);
    expect(fake.receiveBatch).toHaveBeenCalledWith(ctx, {
      jobId: JOB,
      rightToProcessConfirmed: true,
      wordingKey: 'import.rightToProcess.v1',
      arrivals: [
        {
          person: { displayName: 'Unnamed applicant', synthetic: true, identifiers: [{ type: 'cv_hash', value: SHA }] },
          source: 'linkedin',
          fileIds: [F1],
        },
      ],
    });
  });

  // SAFETY: mutation check: wrapped the handler in inActiveWorkspace instead of workspaceAction('candidate.create') (no authorize) -> this test failed (resolved, and the file was read)
  it('Scenario: Only recruiters upload: an interviewer gets 403 before any file is read', async () => {
    fake.authorize.mockRejectedValue(new ForbiddenError());
    await expect(addApplicants(input)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
    expect(fake.findCleanUpload).not.toHaveBeenCalled();
    expect(fake.receiveBatch).not.toHaveBeenCalled();
  });

  it('a job outside the workspace is "jobNotFound"', async () => {
    fake.receiveBatch.mockRejectedValue(new IntakeError('job_not_found'));
    expect(await addApplicants(input)).toEqual({ ok: false, error: 'jobNotFound' });
  });

  // SAFETY: mutation check: mapped every IntakeError other than confirmation_required back to jobNotFound -> this test failed
  it('any other intake refusal is the generic "failed", not "jobNotFound"', async () => {
    fake.receiveBatch.mockRejectedValue(new IntakeError('invalid_wording'));
    expect(await addApplicants(input)).toEqual({ ok: false, error: 'failed' });
  });

  // AIV-P1-104. SAFETY: mutation check: removed the rightToProcessConfirmed literal from addApplicantsSchema -> this test failed (the batch was filed)
  it('Scenario: The server refuses a batch without the confirmation: the message, nothing read or filed', async () => {
    const { rightToProcessConfirmed: _, ...unconfirmed } = input;
    expect(await addApplicants(unconfirmed as never)).toEqual({ ok: false, error: 'confirmationRequired' });
    expect(await addApplicants({ ...input, rightToProcessConfirmed: false as never })).toEqual({
      ok: false,
      error: 'confirmationRequired',
    });
    expect(fake.findCleanUpload).not.toHaveBeenCalled();
    expect(fake.receiveBatch).not.toHaveBeenCalled();
  });

  it('refuses input that is not a job, a source and file ids, before authorising', async () => {
    await expect(addApplicants({ ...input, fileIds: ['cv.pdf'] })).rejects.toMatchObject({ name: 'ZodError' });
    expect(fake.authorize).not.toHaveBeenCalled();
  });
});
