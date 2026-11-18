import { JOB_SCOPED_ROLES, type Action } from '../domain/permissions.ts';
import { WorkspaceError, type Client, type JobGrant, type WorkspaceType } from '../domain/workspace.ts';
import type { WorkspaceContext } from './context.ts';
import type { WorkspaceStore } from './workspaces.ts';

/**
 * One member's access to one job, or to all of one client's jobs. Ids are uuids; the server action validates them
 * with zod (AGENTS.md 3.7). shortcut: a job id is not checked against the jobs module, which does not exist yet; check
 * it through the jobs contract once AIV-P1-005 ships.
 */
export type GrantJobAccessInput = { userId: string } & (
  { jobId: string; clientId?: never } | { clientId: string; jobId?: never }
);

export type ClientsPorts<Tx> = {
  storeFor(tx: Tx): WorkspaceStore;
  newId(): string;
  authorize(ctx: WorkspaceContext<Tx>, action: Action): Promise<void>;
};

const target = (g: JobGrant) => ({ grantId: g.id, jobId: g.jobId, clientId: g.clientId });

const clientName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) throw new WorkspaceError('client_name');
  return trimmed;
};

/** Workspace type, agency clients and job grants (AIV-P0-906, ADR-005 point 6). Every write is audited last. */
export function clientsUseCases<Tx>({ storeFor, newId, authorize }: ClientsPorts<Tx>) {
  return {
    /** Admins only. An agency with clients that are not archived cannot become an in-house team. */
    async setWorkspaceType(ctx: WorkspaceContext<Tx>, type: WorkspaceType): Promise<void> {
      await authorize(ctx, 'workspace.settings');
      const store = storeFor(ctx.tx);
      const workspace = await store.lockWorkspace(ctx.workspaceId);
      if (!workspace || workspace.type === type) return;
      if (type === 'in_house' && (await store.countClients(ctx.workspaceId)) > 0)
        throw new WorkspaceError('has_clients');
      await store.updateType(ctx.workspaceId, type);
      await store.audit(ctx.workspaceId, ctx.userId, {
        action: 'workspace.type_changed',
        subject: { type: 'workspace', id: ctx.workspaceId },
        before: { type: workspace.type },
        after: { type },
      });
    },

    async listClients(ctx: WorkspaceContext<Tx>): Promise<Client[]> {
      await authorize(ctx, 'client.manage');
      return storeFor(ctx.tx).listClients(ctx.workspaceId);
    },

    /** Admins and recruiters of an agency. Names are unique in the workspace whatever their case. */
    async addClient(ctx: WorkspaceContext<Tx>, name: string): Promise<Client> {
      await authorize(ctx, 'client.manage');
      const store = storeFor(ctx.tx);
      if ((await store.lockWorkspace(ctx.workspaceId))?.type !== 'agency') throw new WorkspaceError('not_agency');
      const client = await store.insertClient(ctx.workspaceId, { id: newId(), name: clientName(name) });
      await store.audit(ctx.workspaceId, ctx.userId, {
        action: 'client.added',
        subject: { type: 'client', id: client.id },
      });
      return client;
    },

    async renameClient(ctx: WorkspaceContext<Tx>, clientId: string, name: string): Promise<void> {
      await authorize(ctx, 'client.manage');
      const store = storeFor(ctx.tx);
      if (!(await store.renameClient(ctx.workspaceId, clientId, clientName(name))))
        throw new WorkspaceError('client_not_found');
      await store.audit(ctx.workspaceId, ctx.userId, {
        action: 'client.renamed',
        subject: { type: 'client', id: clientId },
      });
    },

    // shortcut: archiving keeps the client's grants, so its old jobs stay open to those members; revoke them here
    // once jobs can be closed with their client (AIV-P1-005).
    async archiveClient(ctx: WorkspaceContext<Tx>, clientId: string): Promise<void> {
      await authorize(ctx, 'client.manage');
      const store = storeFor(ctx.tx);
      if (!(await store.archiveClient(ctx.workspaceId, clientId))) throw new WorkspaceError('client_not_found');
      await store.audit(ctx.workspaceId, ctx.userId, {
        action: 'client.archived',
        subject: { type: 'client', id: clientId },
      });
    },

    /** Admins only; the member must be an active hiring owner or interviewer. Granting twice changes nothing. */
    async grantJobAccess(ctx: WorkspaceContext<Tx>, input: GrantJobAccessInput): Promise<void> {
      await authorize(ctx, 'job_access.manage');
      const store = storeFor(ctx.tx);
      // Locks the members in changeRole's order, so a concurrent change to recruiter cannot keep this grant.
      const member = (await store.lockMembers(ctx.workspaceId)).find(
        (m) => m.userId === input.userId && m.status === 'active',
      );
      if (!member) throw new WorkspaceError('not_found');
      if (!JOB_SCOPED_ROLES.includes(member.role)) throw new WorkspaceError('grant_role');
      // An archived client takes no new grants.
      if (input.clientId) {
        const client = await store.findClient(ctx.workspaceId, input.clientId);
        if (!client || client.archivedAt) throw new WorkspaceError('client_not_found');
      }
      const grant = await store.insertGrant(ctx.workspaceId, {
        id: newId(),
        userId: input.userId,
        jobId: input.jobId ?? null,
        clientId: input.clientId ?? null,
        grantedBy: ctx.userId,
      });
      if (!grant) return;
      await store.audit(ctx.workspaceId, ctx.userId, {
        action: 'job_access.granted',
        subject: { type: 'member', id: grant.userId },
        after: target(grant),
      });
    },

    /** Admins only. Takes effect on the member's next request, which reloads their grants. */
    async revokeJobAccess(ctx: WorkspaceContext<Tx>, grantId: string): Promise<void> {
      await authorize(ctx, 'job_access.manage');
      const store = storeFor(ctx.tx);
      const grant = await store.deleteGrant(ctx.workspaceId, grantId);
      if (!grant) return;
      await store.audit(ctx.workspaceId, ctx.userId, {
        action: 'job_access.revoked',
        subject: { type: 'member', id: grant.userId },
        before: target(grant),
      });
    },

    /** Every grant in the workspace, for admins and recruiters. */
    async listJobGrants(ctx: WorkspaceContext<Tx>): Promise<JobGrant[]> {
      await authorize(ctx, 'job_access.view');
      return storeFor(ctx.tx).listGrants(ctx.workspaceId);
    },
  };
}
