'use server';

import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { log } from '@aivera/observability';
import { WorkspaceError, type Invitation, type WorkspaceContext } from '@aivera/workspaces';
import { revalidatePath } from 'next/cache';
import { forbidden, unstable_rethrow } from 'next/navigation';
import { getIdentity } from '@/server/auth';
import { getJobs } from '@/server/jobs';
import { getNotifications } from '@/server/notifications';
import { getWorkspaces, inActiveWorkspace } from '@/server/workspace';
import { inviteQuery } from '../domain/accept.ts';
import {
  initialInviteState,
  possessive,
  parseInviteForm,
  parseManageForm,
  type InviteState,
  type ManageState,
} from '../domain/members.ts';

const MEMBERS = '/app/settings/members';

/** Only the workspace's own jobs may be named: the workspaces module does not know the jobs module's ids. */
const assertOwnJobs = async (ctx: WorkspaceContext, jobIds: string[]) => {
  const known = new Set((await getJobs().listJobs(ctx)).map((j) => j.id));
  // A job that is not the workspace's is treated as no job chosen: the form only offers the workspace's own.
  if (!jobIds.every((id) => known.has(id))) throw new WorkspaceError('jobs_required');
};

/**
 * Queues the invitation email (EInvite and ERoles artboards) in the invitation's transaction: from the inviting admin,
 * naming the jobs and clients, with the accept link. Throws when this environment cannot send email, so no invitation
 * is stored without its email.
 */
async function queueInvitationEmail(ctx: WorkspaceContext, invitation: Invitation, token: string): Promise<void> {
  const email = getNotifications();
  if (!email) throw new Error('email is not configured in this environment');
  const workspaces = getWorkspaces();
  const [workspace, inviter, jobs, clients, t] = [
    await workspaces.getWorkspace(ctx),
    await getIdentity().getUser(ctx.userId),
    await getJobs().listJobs(ctx),
    invitation.clientIds.length ? await workspaces.listClients(ctx) : [],
    await getTranslations(defaultLocale, defaultTimeZone),
  ];
  if (!workspace || !inviter) throw new Error('inviter or workspace not found');
  const scope = [
    ...jobs.filter((j) => invitation.jobIds.includes(j.id)).map((j) => j.title),
    ...clients
      .filter((c) => invitation.clientIds.includes(c.id))
      .map((c) => t('emails.memberInvitation.allOfClient', { client: possessive(c.name) })),
  ].join(', ');
  const name = inviter.displayName ?? inviter.email;
  await email.notifications.queueEmail(
    { tx: ctx.tx, workspaceId: ctx.workspaceId },
    {
      template: 'member-invitation',
      to: invitation.email,
      causedBy: invitation.id,
      sender: { name, shortName: name.split(' ')[0] ?? name, email: inviter.email, workspace: workspace.name },
      data: {
        role: invitation.role,
        scope: scope || null,
        expiresAt: invitation.expiresAt,
        link: `${email.origin}/invite${inviteQuery(token)}`,
      },
    },
  );
}

const logFailure = (area: string, error: unknown) =>
  // The name only: an error's detail can repeat the email typed (AGENTS.md 1.2).
  log.error({ area, 'error.type': error instanceof Error ? error.name : 'unknown' }, 'members change failed');

/**
 * "Invite" (AIV-P1-003): validates the form (AGENTS.md 3.7), then, as an admin of the active workspace (`member.invite`
 * in the module; anyone else gets the 403 page), stores the invitation and queues its email in one transaction. The
 * workspace and the inviter come from the server, never from the form.
 */
export async function inviteMember(_previous: InviteState, form: FormData): Promise<InviteState> {
  const values = { email: String(form.get('email') ?? ''), title: String(form.get('title') ?? '') };
  const parsed = parseInviteForm(form);
  if ('error' in parsed) return { error: parsed.error, invited: null, values };
  const { input } = parsed;
  let result;
  try {
    result = await inActiveWorkspace(async (ctx) => {
      await assertOwnJobs(ctx, input.jobIds);
      const { invitation } = await getWorkspaces().inviteMember(
        ctx,
        { ...input, title: input.title || null },
        (sent, token) => queueInvitationEmail(ctx, sent, token),
      );
      return invitation.expiresAt.toISOString();
    });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof WorkspaceError && error.code === 'jobs_required')
      return { error: 'jobsRequired', invited: null, values };
    logFailure('members-invite', error);
    return { error: 'failed', invited: null, values };
  }
  if (!result) forbidden();
  revalidatePath(MEMBERS);
  return { ...initialInviteState, invited: { email: input.email, expiresAt: result.value } };
}

/**
 * A change to one row of the members list, as an admin of the active workspace: change a member's role or jobs, remove
 * them, or revoke an invitation. Each is authorised and audited in the module; anyone else gets the 403 page.
 */
export async function manageMember(previous: ManageState, form: FormData): Promise<ManageState> {
  const failed: ManageState = { error: 'failed', done: previous.done };
  const input = parseManageForm(form);
  if (!input) return failed;
  let result;
  try {
    const workspaces = getWorkspaces();
    result = await inActiveWorkspace(async (ctx) => {
      if (input.intent === 'role') {
        await workspaces.authorize(ctx, 'member.invite');
        return { workspaceId: ctx.workspaceId, actorUserId: ctx.userId };
      }
      if (input.intent === 'jobs') {
        await assertOwnJobs(ctx, input.jobIds);
        await workspaces.changeJobAccess(ctx, input.userId, input);
      } else if (input.intent === 'remove') await workspaces.removeMember(ctx, input.userId);
      else await workspaces.revokeInvitation(ctx, input.invitationId);
      return null;
    });
    // changeRole opens its own transaction (it locks the members and re-checks the admin), so it runs after the
    // authorised context has closed, never holding a second connection inside it.
    // shortcut: a suspension landing between the two is not re-checked; give changeRole a ctx form when it next changes.
    if (result?.value && input.intent === 'role')
      await workspaces.changeRole({ ...result.value, targetUserId: input.userId, role: input.role });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof WorkspaceError && error.code === 'last_admin')
      return { error: 'lastAdmin', done: previous.done };
    logFailure('members-manage', error);
    return failed;
  }
  if (!result) forbidden();
  revalidatePath(MEMBERS);
  return { error: null, done: previous.done + 1 };
}
