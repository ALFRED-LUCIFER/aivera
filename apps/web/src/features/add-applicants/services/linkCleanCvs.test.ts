import type { Purpose } from '@credalent/files';
import type { ReceiveBatchInput } from '@credalent/intake';
import type { WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it, vi } from 'vitest';
import { linkCleanCvs } from './linkCleanCvs.ts';

// AIV-P1-019: the files module's record decides what is linked. Synthetic opaque ids only.
const JOB = '0190d4a2-0000-7000-9000-000000001031';
const ids = ['f1', 'f2', 'f3'].map((n) => `0190d4a2-0000-7000-8000-0000000000${n}`);
const hash = (n: number) => n.toString(16).padStart(64, '0');
const ctx = {} as WorkspaceContext;
const person = { displayName: 'Unnamed applicant', synthetic: true };

function ports(clean: Record<string, { purpose: Purpose; sha256: string } | null>) {
  const files = { findCleanUpload: vi.fn(async (_: WorkspaceContext, id: string) => clean[id] ?? null) };
  const intake = {
    receiveBatch: vi.fn(async (_: WorkspaceContext, input: ReceiveBatchInput) => ({
      batchId: 'b',
      applications: input.arrivals.map((a) => ({
        applicationId: `app-${a.person.identifiers[0]?.value}`,
        personId: 'p',
        sourceId: 's',
        created: true,
      })),
    })),
  };
  return { files, intake };
}

describe('linkCleanCvs', () => {
  it('Scenario: Manual upload with a source: 3 clean CVs from LinkedIn are 3 CV-only applicants', async () => {
    const p = ports(Object.fromEntries(ids.map((id, i) => [id, { purpose: 'cv', sha256: hash(i) }])));
    const result = await linkCleanCvs(
      p,
      ctx,
      { jobId: JOB, rightToProcessConfirmed: true, source: 'linkedin', fileIds: ids },
      person,
    );
    expect(result).toMatchObject({ ok: true, applications: [{ created: true }, { created: true }, { created: true }] });
    // Scenario: Each save of Add applicants is its own batch: one call for the three, under the wording key.
    expect(p.intake.receiveBatch).toHaveBeenCalledOnce();
    expect(p.intake.receiveBatch).toHaveBeenCalledWith(ctx, {
      jobId: JOB,
      rightToProcessConfirmed: true,
      wordingKey: 'import.rightToProcess.v1',
      arrivals: [0, 1, 2].map((i) => ({
        person: {
          displayName: 'Unnamed applicant',
          synthetic: true,
          identifiers: [{ type: 'cv_hash', value: hash(i) }],
        },
        source: 'linkedin',
        fileIds: [ids[i]],
      })),
    });
  });

  // SAFETY: mutation check: linked each file without waiting for findCleanUpload's answer (`clean?.purpose !== 'cv'` check removed) -> this test failed (receiveBatch called)
  it.each([
    ['pending, infected or rejected (not clean)', null],
    ['clean but not a CV', { purpose: 'evidence' as const, sha256: hash(9) }],
  ])('a file that is %s links nothing, not even the clean ones before it', async (_, refused) => {
    const p = ports({ [ids[0] ?? '']: { purpose: 'cv', sha256: hash(0) }, [ids[1] ?? '']: refused });
    const result = await linkCleanCvs(
      p,
      ctx,
      { jobId: JOB, rightToProcessConfirmed: true, source: 'email', fileIds: ids.slice(0, 2) },
      person,
    );
    expect(result).toEqual({ ok: false, error: 'notAccepted' });
    expect(p.intake.receiveBatch).not.toHaveBeenCalled();
  });
});
