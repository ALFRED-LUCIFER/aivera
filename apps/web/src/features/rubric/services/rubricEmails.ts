import { approvesAs, type Rubric, type RubricVersion } from '@credalent/jobs';
import type { WorkspaceContext } from '@credalent/workspaces';
import { getIdentity } from '@/server/auth';
import { getJobs } from '@/server/jobs';
import { getNotifications, senderFor } from '@/server/notifications';
import { getWorkspaces } from '@/server/workspace';
import { reviewPath } from '../domain/rubric.ts';

// The rubric approval emails (AIV-P1-014), queued in the confirmed action's transaction, so none is sent unless the
// action commits. Each throws when this environment cannot send email, so no version is sent or decided without it.

const configured = () => {
  const email = getNotifications();
  if (!email) throw new Error('email is not configured in this environment');
  return email;
};

/** The job's versions, and the one asked for; throws when it is not this job's, so a forged job id sends nothing. */
async function versionOf(ctx: WorkspaceContext, jobId: string, versionId: string) {
  const versions = (await getJobs().listRubricVersions(ctx, jobId)) ?? [];
  const version = versions.find((v) => v.id === versionId);
  if (!version) throw new Error('rubric version not found for this job');
  return { versions, version };
}

/**
 * "Rubric waiting for your approval" (ERubric) to the job's hiring owner, from the recruiter who sent it, linking to
 * the version and revision sent. Nothing is queued for a job with no hiring owner, or one who can no longer approve it
 * (removed, or no longer a hiring owner or admin, AIV-P2-060): its recruiters approve it themselves (ADR-014). Returns
 * whether an email was queued.
 */
export async function queueApprovalRequest(ctx: WorkspaceContext, sent: RubricVersion): Promise<boolean> {
  const job = await getJobs().getJob(ctx, sent.jobId);
  if (!job?.hiringOwnerUserId) return false;
  // shortcut: a job whose owner was removed before AIV-P2-060 keeps their id, so its header still shows their name; this
  // check stops the email. Clear such owners when the job header lets an admin assign another (AIV-P1-097, #495).
  // Read in the action's transaction, as is the owner below: a second pooled connection while it is held can exhaust the
  // pool (AIV-P2-061).
  const member = (await getWorkspaces().listMembers(ctx)).find(
    (m) => m.userId === job.hiringOwnerUserId && m.status === 'active',
  );
  if (!member || approvesAs(member.role, member.userId, job) !== 'owner') return false;
  const email = configured();
  const owner = await getIdentity().getUser(job.hiringOwnerUserId, ctx);
  if (!owner) throw new Error('hiring owner not found');
  const { versions, version } = await versionOf(ctx, job.id, sent.id);
  const approved = versions.find((v) => v.status === 'approved');
  await email.notifications.queueEmail(
    { tx: ctx.tx, workspaceId: ctx.workspaceId },
    {
      template: 'rubric-approval',
      to: owner.email,
      causedBy: sent.id,
      sender: await senderFor(ctx),
      data: {
        jobTitle: job.title,
        version: version.version,
        competencies: version.competencies.map(({ name, weightPercent, levelNeeded }) => ({
          name,
          weightPercent,
          levelNeeded,
        })),
        changes: approved && version.changeNote ? { since: approved.version, note: version.changeNote } : null,
        link: `${email.origin}${reviewPath(job.id, { versionId: sent.id, revision: sent.revision })}`,
      },
    },
  );
  return true;
}

/**
 * "Rubric approved" (EApproved) or "Rubric returned with a note" (EReturned) to whoever sent the version, from the
 * person who decided. Nothing is queued for a version never sent (a draft a recruiter approved directly, ADR-014) or
 * one the decider sent themselves.
 */
export async function queueDecisionEmail(ctx: WorkspaceContext, jobId: string, versionId: string): Promise<void> {
  const { versions, version } = await versionOf(ctx, jobId, versionId);
  // Only someone who sent the version is told the outcome: a draft approved directly emails no one (ADR-014).
  const recipientId = version.submittedBy;
  if (!recipientId || recipientId === ctx.userId) return;
  const email = configured();
  const recipient = await getIdentity().getUser(recipientId, ctx);
  if (!recipient) throw new Error('recipient not found');
  const job = await getJobs().getJob(ctx, jobId);
  if (!job) throw new Error('job not found');
  const common = {
    to: recipient.email,
    causedBy: version.id,
    sender: await senderFor(ctx),
  };
  const queue = (input: Parameters<typeof email.notifications.queueEmail>[1]) =>
    email.notifications.queueEmail({ tx: ctx.tx, workspaceId: ctx.workspaceId }, input);
  if (version.status === 'approved' && version.approvedAt)
    return void (await queue({
      ...common,
      template: 'rubric-approved',
      data: {
        jobTitle: job.title,
        version: version.version,
        approvedAt: version.approvedAt,
        link: `${email.origin}/app/jobs/${job.id}`,
      },
    }));
  if (version.status === 'returned' && version.returnNote)
    return void (await queue({
      ...common,
      template: 'rubric-returned',
      data: {
        jobTitle: job.title,
        version: version.version,
        note: version.returnNote,
        inForce: versions.some((v: Rubric) => v.status === 'approved'),
        link: `${email.origin}/app/jobs/${job.id}/rubric`,
      },
    }));
  throw new Error('the version was neither approved nor returned');
}
