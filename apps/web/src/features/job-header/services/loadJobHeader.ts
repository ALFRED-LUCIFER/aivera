import { z } from 'zod';
import { getAssessment } from '@/server/assessment';
import { getIdentity } from '@/server/auth';
import { getDecisions } from '@/server/decisions';
import { getIntake } from '@/server/intake';
import { getJobs } from '@/server/jobs';
import { clientName, getWorkspaces, inActiveWorkspace } from '@/server/workspace';

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
    // Intake's count, composed here for the same reason (AIV-P1-101): jobs never imports intake.
    const imported = header ? await getIntake().countApplications(ctx, id) : 0;
    // The picker is the admin's alone (`job.change_owner`); their members are read here, in the same transaction.
    const members =
      header && ctx.role === 'admin'
        ? (await getWorkspaces().listMembers(ctx)).filter((m) => m.status === 'active' && m.role === 'hiring_owner')
        : null;
    // "Shortlist ready" while the job has an undecided pack (AIV-P2-011); interviewers may not read packs (`pack.view`).
    const shortlistReady =
      header && ctx.role !== 'interviewer'
        ? (await getDecisions().listPacks(ctx, id)).some((p) => p.status === 'ready')
        : false;
    return {
      header,
      // "Client: Falcon Pay" on an agency's job (AIV-P1-165), for the members who may list clients.
      client: await clientName(ctx, header?.job.clientId ?? null),
      assessed,
      imported,
      shortlistReady,
      members,
      jobScoped: ctx.role !== 'admin' && ctx.role !== 'recruiter',
    };
  });
  if (!result) return null;
  const { header, client, assessed, imported, shortlistReady, members, jobScoped } = result.value;
  if (!header) return { missing: jobScoped ? ('forbidden' as const) : ('notFound' as const) };
  const owner = header.job.hiringOwnerUserId && (await getIdentity().getUser(header.job.hiringOwnerUserId));
  // shortcut: one identity read per hiring-owner member, as the members screen does; batch it with identity.
  const options =
    members &&
    (await Promise.all(
      members.map(async (m) => {
        const user = await getIdentity().getUser(m.userId);
        return { userId: m.userId, name: m.title || user?.displayName || user?.email || '' };
      }),
    ));
  const ownerChange = options && { currentUserId: header.job.hiringOwnerUserId, options };
  return {
    header,
    client,
    assessed,
    imported,
    shortlistReady,
    ownerChange,
    hiringOwner: owner ? (owner.displayName ?? owner.email) : null,
    // Adding candidates is `candidate.create`: admins and recruiters; the action checks it again (AIV-P1-019).
    canImport: !jobScoped,
  };
}
