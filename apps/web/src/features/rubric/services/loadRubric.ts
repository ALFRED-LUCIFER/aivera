import { approvesAs } from '@credalent/jobs';
import { z } from 'zod';
import { getIdentity } from '@/server/auth';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import { rubricView, type RubricView } from '../domain/rubric.ts';

/**
 * The rubric page (AIV-P1-012): every version through `listRubricVersions`, which checks `job.view` and the member's
 * job scope, with approvers' names. Null when the job is not visible or there is no workspace.
 */
export async function loadRubric(jobId: string): Promise<{
  rubric: RubricView;
  canEdit: boolean;
  /** Whether this member decides on the version awaiting approval (AIV-P1-014); the jobs module checks again. */
  approver: ReturnType<typeof approvesAs>;
} | null> {
  // The layout runs alongside this page, so a malformed id must not reach the database from here either.
  if (!z.uuid().safeParse(jobId).success) return null;
  const result = await inActiveWorkspace(async (ctx) => ({
    versions: await getJobs().listRubricVersions(ctx, jobId),
    // Who sees edit mode; saving checks rubric.edit again in the jobs module.
    canEdit: ctx.role === 'admin' || ctx.role === 'recruiter',
    job: await getJobs().getJob(ctx, jobId),
    role: ctx.role,
    userId: ctx.userId,
  }));
  const versions = result?.value.versions;
  const job = result?.value.job;
  if (!result || !versions || !job) return null;
  const approvers = [...new Set(versions.flatMap((v) => v.approvedBy ?? []))];
  const names = new Map(
    await Promise.all(
      approvers.map(async (id) => {
        const user = await getIdentity().getUser(id);
        return [id, user ? (user.displayName ?? user.email) : ''] as const;
      }),
    ),
  );
  const { canEdit, role, userId } = result.value;
  return { rubric: rubricView(versions, names), canEdit, approver: approvesAs(role, userId, job) };
}
