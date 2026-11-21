import { createHash, randomBytes } from 'node:crypto';
import {
  assertAccessFitsRole,
  invitationExpiry,
  invitationState,
  type Invitation,
  type InvitationState,
} from '../domain/invitation.ts';
import { WorkspacePausedError, type Action } from '../domain/permissions.ts';
import { withDefaults } from '../domain/settings.ts';
import { assertCanChangeRole, WorkspaceError, type JobGrant, type Role } from '../domain/workspace.ts';
import type { GrantJobAccessInput } from './clients.ts';
import type { WorkspaceContext } from './context.ts';
import type { WorkspaceStore } from './workspaces.ts';

/** Job ids are opaque jobs-module ids; the caller checks them against the jobs the workspace has. */
export type JobAccess = { jobIds: string[]; clientIds: string[] };
export type InviteMemberInput = JobAccess & { email: string; role: Role; title: string | null };

/** What the accept page shows about a link: the invitation, its workspace's name and whether it is still open. */
export type InvitationView = { invitation: Invitation; workspaceName: string; state: InvitationState };

export type InvitationPorts<Tx> = {
  storeFor(tx: Tx): WorkspaceStore;
  /** Runs `work` in the workspace's scoped transaction, with no member check: the invitee is not a member yet. */
  inWorkspace<T>(workspaceId: string, work: (store: WorkspaceStore) => Promise<T>): Promise<T>;
  newId(): string;
  now(): Date;
  authorize(ctx: WorkspaceContext<Tx>, action: Action): Promise<void>;
  grantJobAccess(ctx: WorkspaceContext<Tx>, input: GrantJobAccessInput): Promise<void>;
  revokeJobAccess(ctx: WorkspaceContext<Tx>, grantId: string): Promise<void>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only this hash of a link's token is stored, so a database read never yields a working link. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * `<workspace id>.<32 random bytes>`: the workspace id lets the link be read inside that workspace's scoped
 * transaction, under its row-level security, with no bypass role (ADR-005).
 */
export const newToken = (workspaceId: string) => `${workspaceId}.${randomBytes(32).toString('base64url')}`;

const workspaceOf = (token: string) => {
  const workspaceId = token.split('.', 1)[0] ?? '';
  return UUID.test(workspaceId) ? workspaceId : null;
};

const unique = (ids: string[]) => [...new Set(ids)];

/** Invitations, membership changes and job access (AIV-P1-003, ADR-009). Every write is audited last. */
export function invitationsUseCases<Tx>(ports: InvitationPorts<Tx>) {
  const { storeFor, inWorkspace, newId, now, authorize } = ports;

  return {
    /**
     * Admins. Stores the invitation with the hash of a new token, valid for the workspace's `invitationDays` (default 7), and runs `alongside` with the token
     * (the caller queues the invitation email there) before the audit write. Throws `jobs_required`, `jobs_not_allowed` or `client_not_found`.
     */
    async inviteMember(
      ctx: WorkspaceContext<Tx>,
      input: InviteMemberInput,
      alongside?: (invitation: Invitation, token: string) => Promise<void>,
    ): Promise<{ invitation: Invitation; token: string }> {
      await authorize(ctx, 'member.invite');
      const access = { jobIds: unique(input.jobIds), clientIds: unique(input.clientIds) };
      assertAccessFitsRole(input.role, access);
      const store = storeFor(ctx.tx);
      for (const clientId of access.clientIds) {
        const client = await store.findClient(ctx.workspaceId, clientId);
        if (!client || client.archivedAt) throw new WorkspaceError('client_not_found');
      }
      const token = newToken(ctx.workspaceId);
      const invitation = await store.insertInvitation(ctx.workspaceId, {
        id: newId(),
        email: input.email.trim().toLowerCase(),
        role: input.role,
        title: input.title?.trim() || null,
        ...access,
        invitedBy: ctx.userId,
        expiresAt: invitationExpiry(now(), withDefaults(await store.readSettings(ctx.workspaceId)).invitationDays),
        tokenHash: hashToken(token),
      });
      // The invitation email, queued in this transaction: no invitation without its email, nor an email without it.
      await alongside?.(invitation, token);
      await store.audit(ctx.workspaceId, ctx.userId, {
        action: 'member.invited',
        subject: { type: 'invitation', id: invitation.id },
        after: { role: invitation.role, jobs: access.jobIds.length, clients: access.clientIds.length },
      });
      return { invitation, token };
    },

    /** Admins. Invitations neither accepted nor revoked, newest first; expired ones included. */
    async listInvitations(ctx: WorkspaceContext<Tx>): Promise<Invitation[]> {
      await authorize(ctx, 'member.invite');
      return storeFor(ctx.tx).listInvitations(ctx.workspaceId);
    },

    /** Admins. The link stops working at once. Revoking an accepted or revoked invitation changes nothing. */
    async revokeInvitation(ctx: WorkspaceContext<Tx>, invitationId: string): Promise<void> {
      await authorize(ctx, 'member.invite');
      const store = storeFor(ctx.tx);
      if (!(await store.closeInvitation(ctx.workspaceId, invitationId, 'revokedAt', now()))) return;
      await store.audit(ctx.workspaceId, ctx.userId, {
        action: 'invitation.revoked',
        subject: { type: 'invitation', id: invitationId },
      });
    },

    /** Public: the invitation behind a link, for the accept page; null for a link that matches none. */
    async findInvitation(token: string): Promise<InvitationView | null> {
      const workspaceId = workspaceOf(token);
      if (!workspaceId) return null;
      return inWorkspace(workspaceId, async (store) => {
        const invitation = await store.findInvitationByHash(workspaceId, hashToken(token), false);
        const workspace = invitation && (await store.findWorkspace(workspaceId));
        if (!invitation || !workspace) return null;
        return { invitation, workspaceName: workspace.name, state: invitationState(invitation, now()) };
      });
    },

    /**
     * The signed-in user accepts: in one transaction they become an active member with the invited role, get the
     * invitation's job grants, land in the workspace, and the acceptance is audited. `email` is the signed-in user's
     * verified email, from the identity module; it must be the invited one. Throws `invitation_invalid` (no such link,
     * expired, revoked or used), `invitation_email`, `already_member`, or `WorkspacePausedError` while the workspace
     * is not active.
     */
    acceptInvitation(user: { userId: string; email: string }, token: string): Promise<{ workspaceId: string }> {
      const workspaceId = workspaceOf(token);
      if (!workspaceId) return Promise.reject(new WorkspaceError('invitation_invalid'));
      return inWorkspace(workspaceId, async (store) => {
        const invitation = await store.findInvitationByHash(workspaceId, hashToken(token), true);
        if (!invitation || invitationState(invitation, now()) !== 'open')
          throw new WorkspaceError('invitation_invalid');
        // Held to commit like every request context, so a suspension waits; a paused workspace takes no new members.
        const workspace = await store.shareWorkspace(workspaceId);
        if (workspace?.status !== 'active') throw new WorkspacePausedError(workspace?.status ?? 'suspended');
        if (invitation.email !== user.email.trim().toLowerCase()) throw new WorkspaceError('invitation_email');
        if ((await store.findMember(workspaceId, user.userId))?.status === 'active')
          throw new WorkspaceError('already_member');
        await store.activateMember({
          workspaceId,
          userId: user.userId,
          role: invitation.role,
          title: invitation.title,
        });
        // A client archived since the invitation was sent takes no new grants, as in grantJobAccess.
        const clientIds: string[] = [];
        for (const clientId of invitation.clientIds)
          if ((await store.findClient(workspaceId, clientId))?.archivedAt === null) clientIds.push(clientId);
        const targets = [
          ...invitation.jobIds.map((jobId) => ({ jobId, clientId: null })),
          ...clientIds.map((clientId) => ({ jobId: null, clientId })),
        ];
        for (const target of targets) {
          const grant = await store.insertGrant(workspaceId, {
            id: newId(),
            userId: user.userId,
            ...target,
            grantedBy: invitation.invitedBy,
          });
          if (grant)
            await store.audit(workspaceId, invitation.invitedBy, {
              action: 'job_access.granted',
              subject: { type: 'member', id: user.userId },
              after: { grantId: grant.id, jobId: grant.jobId, clientId: grant.clientId },
            });
        }
        await store.closeInvitation(workspaceId, invitation.id, 'acceptedAt', now());
        await store.setActiveWorkspace(user.userId, workspaceId);
        await store.audit(workspaceId, user.userId, {
          action: 'invitation.accepted',
          subject: { type: 'invitation', id: invitation.id },
          after: { userId: user.userId, role: invitation.role, grants: targets.length },
        });
        return { workspaceId };
      });
    },

    /**
     * Admins. Gives an active hiring owner or interviewer exactly these jobs and clients: grants not listed are revoked
     * and new ones granted, each audited. Takes effect on the member's next request.
     */
    async changeJobAccess(ctx: WorkspaceContext<Tx>, userId: string, access: JobAccess): Promise<void> {
      await authorize(ctx, 'job_access.manage');
      const current = await storeFor(ctx.tx).listGrants(ctx.workspaceId, userId);
      const kept = (g: JobGrant) =>
        g.jobId ? access.jobIds.includes(g.jobId) : !!g.clientId && access.clientIds.includes(g.clientId);
      for (const grant of current.filter((g) => !kept(g))) await ports.revokeJobAccess(ctx, grant.id);
      for (const jobId of unique(access.jobIds))
        if (!current.some((g) => g.jobId === jobId)) await ports.grantJobAccess(ctx, { userId, jobId });
      for (const clientId of unique(access.clientIds))
        if (!current.some((g) => g.clientId === clientId)) await ports.grantJobAccess(ctx, { userId, clientId });
    },

    /**
     * Admins. The member loses access on their next request, their job grants go and their active workspace stops
     * pointing here; the last admin stays.
     */
    async removeMember(ctx: WorkspaceContext<Tx>, userId: string): Promise<void> {
      await authorize(ctx, 'member.invite');
      const store = storeFor(ctx.tx);
      const members = await store.lockMembers(ctx.workspaceId);
      // Removing someone is them stopping being an admin, among other things: the same last-admin rule.
      assertCanChangeRole(members, ctx.userId, userId, 'recruiter');
      for (const grant of await store.deleteGrantsOf(ctx.workspaceId, userId))
        await store.audit(ctx.workspaceId, ctx.userId, {
          action: 'job_access.revoked',
          subject: { type: 'member', id: userId },
          before: { grantId: grant.id, jobId: grant.jobId, clientId: grant.clientId },
        });
      await store.updateMemberStatus(ctx.workspaceId, userId, 'removed');
      await store.clearActiveWorkspace(userId, ctx.workspaceId);
      await store.audit(ctx.workspaceId, ctx.userId, {
        action: 'member.removed',
        subject: { type: 'member', id: userId },
        before: { role: members.find((m) => m.userId === userId)?.role ?? null },
      });
    },
  };
}
