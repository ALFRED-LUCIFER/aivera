import { z } from 'zod';
import { getAssessment } from '@/server/assessment';
import { getIdentity } from '@/server/auth';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';

const jobId = z.uuid();

/**
 * The job page header (AIV-P1-011). `missing` is 'notFound' for a job the workspace does not have (another
 * workspace's, or no such id), and 'forbidden' when a job-scoped member (hiring owner, interviewer) cannot see it:
 * row-level security hides an ungranted job, so neither says whether it exists. Null when the user has no workspace
 * yet (the recruiter layout shows that page instead).
 */
export async function loadJobHeader(id: string) {
  if (!jobId.safeParse(id).success) return { missing: 'notFound' as const };
  const result = await inActiveWorkspace(async (ctx) => {
    const header = await getJobs().getJobHeader(ctx, id);
    // Composed here, not in jobs, which cannot import assessment; the same transaction (AIV-P1-099).
    const assessed = header ? ((await getAssessment().countAssessed(ctx, [id]))[id] ?? 0) : 0;
    return { header, assessed, jobScoped: ctx.role !== 'admin' && ctx.role !== 'recruiter' };
  });
  if (!result) return null;
  const { header, assessed, jobScoped } = result.value;
  if (!header) return { missing: jobScoped ? ('forbidden' as const) : ('notFound' as const) };
  const owner = header.job.hiringOwnerUserId && (await getIdentity().getUser(header.job.hiringOwnerUserId));
  return { header, assessed, hiringOwner: owner ? (owner.displayName ?? owner.email) : null };
}
