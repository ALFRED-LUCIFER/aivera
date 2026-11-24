import type { FilesContract } from '@credalent/files';
import type { IntakeContract } from '@credalent/intake';
import type { WorkspaceContext } from '@credalent/workspaces';
import { RIGHT_TO_PROCESS_KEY, type AddApplicantsInput, type AddApplicantsResult } from '../domain/addApplicants.ts';

// Not a 'use server' file: every async export there becomes a callable action, and this one trusts its ports.

export type LinkPorts = {
  files: Pick<FilesContract, 'findCleanUpload'>;
  intake: Pick<IntakeContract, 'receiveBatch'>;
};

/**
 * One application per clean CV the caller uploaded, from `input.source`. A person with only a CV is known by its hash
 * until parsing (AIV-P1-025) reads their name, so the same CV again adds a source to their application. Every file is
 * re-read first, and one that is not a clean CV links nothing. Intake throws `IntakeError('job_not_found')` for a job
 * outside the workspace.
 */
export async function linkCleanCvs(
  { files, intake }: LinkPorts,
  ctx: WorkspaceContext,
  input: AddApplicantsInput,
  person: { displayName: string; synthetic: boolean },
): Promise<AddApplicantsResult> {
  const cvs = [];
  for (const fileId of input.fileIds) {
    // SAFETY: the browser's word that a file is clean is never trusted; the files module's own record decides.
    const clean = await files.findCleanUpload(ctx, fileId);
    if (clean?.purpose !== 'cv') return { ok: false, error: 'notAccepted' };
    cvs.push({ fileId, sha256: clean.sha256 });
  }
  // One save is one batch, whatever its size (AIV-P1-104).
  const { applications } = await intake.receiveBatch(ctx, {
    jobId: input.jobId,
    rightToProcessConfirmed: input.rightToProcessConfirmed,
    wordingKey: RIGHT_TO_PROCESS_KEY,
    arrivals: cvs.map((cv) => ({
      person: { ...person, identifiers: [{ type: 'cv_hash' as const, value: cv.sha256 }] },
      source: input.source,
      fileIds: [cv.fileId],
    })),
  });
  return { ok: true, applications: applications.map(({ applicationId, created }) => ({ applicationId, created })) };
}
