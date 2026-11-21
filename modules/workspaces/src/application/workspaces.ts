import type { NewEntry, PlatformAction } from '@credalent/audit';
import type { Invitation } from '../domain/invitation.ts';
import { JOB_SCOPED_ROLES } from '../domain/permissions.ts';
import {
  assertCanChangeRole,
  type Client,
  type JobGrant,
  type Member,
  type MemberStatus,
  type Role,
  type Workspace,
  type WorkspaceStatus,
  type WorkspaceType,
} from '../domain/workspace.ts';

/** The store a use case sees inside one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type WorkspaceStore = {
  /** Also adds it to the platform directory (ADR-012 point 6). */
  insertWorkspace(workspace: Omit<Workspace, 'createdAt'>): Promise<Workspace>;
  /** False, with nothing written, when the user is already a member. */
  insertMember(member: Omit<Member, 'title'>): Promise<boolean>;
  findWorkspace(workspaceId: string): Promise<Workspace | null>;
  /**
   * The workspace row under FOR KEY SHARE until commit: every request context holds it, so an operator's status change
   * (which locks FOR UPDATE) waits for work in flight to finish, up to the lock timeout (then a 55P03 DbQueryError and
   * the operator retries), and work that starts later reads the new status.
   */
  shareWorkspace(workspaceId: string): Promise<Workspace | null>;
  /** Points the user's active workspace here (not workspace-owned; see the schema). */
  setActiveWorkspace(userId: string, workspaceId: string): Promise<void>;
  /** Clears the user's active-workspace pointer when it names this workspace (their membership here ended). */
  clearActiveWorkspace(userId: string, workspaceId: string): Promise<void>;
  findMember(workspaceId: string, userId: string): Promise<Member | null>;
  listMembers(workspaceId: string): Promise<Member[]>;
  /** Every member, locked until commit, so two concurrent role changes cannot both remove an admin. */
  lockMembers(workspaceId: string): Promise<Member[]>;
  updateRole(workspaceId: string, userId: string, role: Role): Promise<void>;
  /**
   * The workspace row under FOR NO KEY UPDATE until commit, so a type change and an added client cannot interleave. Not
   * FOR UPDATE: that would conflict with the KEY SHARE every request context holds, and two such requests would
   * deadlock.
   */
  lockWorkspace(workspaceId: string): Promise<Workspace | null>;
  /**
   * The workspace row under FOR UPDATE until commit, for a status change: it waits for the requests in flight, up to the
   * lock timeout (a 55P03 DbQueryError; the operator retries).
   */
  lockWorkspaceStatus(workspaceId: string): Promise<Workspace | null>;
  updateType(workspaceId: string, type: WorkspaceType): Promise<void>;
  updateStatus(workspaceId: string, status: WorkspaceStatus): Promise<void>;
  /** Deletes the workspace with its members, clients, job grants, settings, active-workspace pointers and directory row. */
  deleteWorkspace(workspaceId: string): Promise<void>;
  /** Clients that are not archived. */
  countClients(workspaceId: string): Promise<number>;
  listClients(workspaceId: string): Promise<Client[]>;
  findClient(workspaceId: string, clientId: string): Promise<Client | null>;
  /** Throws `WorkspaceError('client_exists')` when the name is taken, whatever its case. */
  insertClient(workspaceId: string, client: { id: string; name: string }): Promise<Client>;
  /** Throws `WorkspaceError('client_exists')` when the name is taken; false when there is no such client. */
  renameClient(workspaceId: string, clientId: string, name: string): Promise<boolean>;
  /** Archives the client (keeps the first archive time); false when there is no such client. */
  archiveClient(workspaceId: string, clientId: string): Promise<boolean>;
  /** The stored settings value (AIV-P1-051), or null when the workspace has never changed one. */
  readSettings(workspaceId: string): Promise<Record<string, unknown> | null>;
  writeSettings(workspaceId: string, value: Record<string, unknown>, updatedBy: string): Promise<void>;
  /** Every grant in the workspace, or only one member's. */
  listGrants(workspaceId: string, userId?: string): Promise<JobGrant[]>;
  /** Null when the member already holds this grant. */
  insertGrant(workspaceId: string, grant: Omit<JobGrant, 'grantedAt'>): Promise<JobGrant | null>;
  /** The deleted grant, or null when there was none. */
  deleteGrant(workspaceId: string, grantId: string): Promise<JobGrant | null>;
  /** The member's grant on that one job, deleted; null when there was none. Client grants are untouched. */
  deleteJobGrant(workspaceId: string, userId: string, jobId: string): Promise<JobGrant | null>;
  /** The member's deleted grants. */
  deleteGrantsOf(workspaceId: string, userId: string): Promise<JobGrant[]>;
  insertInvitation(
    workspaceId: string,
    invitation: Omit<Invitation, 'acceptedAt' | 'revokedAt' | 'createdAt'> & { tokenHash: string },
  ): Promise<Invitation>;
  /** Invitations neither accepted nor revoked (open or expired), newest first. */
  listInvitations(workspaceId: string): Promise<Invitation[]>;
  /** The invitation with this token hash; null when none. `lock` holds it until commit, so two accepts cannot both join. */
  findInvitationByHash(workspaceId: string, tokenHash: string, lock: boolean): Promise<Invitation | null>;
  /** Sets `acceptedAt` or `revokedAt` on an invitation neither accepted nor revoked; false when it was. */
  closeInvitation(
    workspaceId: string,
    invitationId: string,
    field: 'acceptedAt' | 'revokedAt',
    at: Date,
  ): Promise<boolean>;
  /** Adds the user as an active member with `role`, or makes an invited or removed member active with it. */
  activateMember(member: Omit<Member, 'status'>): Promise<void>;
  updateMemberStatus(workspaceId: string, userId: string, status: MemberStatus): Promise<void>;
  /** Sets app.job_scope, app.job_ids and app.client_ids for this transaction only (ADR-005 point 6). */
  setJobScope(scope: 'all' | 'granted', grants: JobGrant[]): Promise<void>;
  /** Appends an audit entry in this transaction, by a user of this workspace. */
  audit(workspaceId: string, actorUserId: string, entry: NewEntry): Promise<void>;
  /** Appends an operator's action in this transaction: to the workspace's log as `operator`, and to the platform log. */
  operatorAudit(workspaceId: string, operatorId: string, entry: NewEntry & { action: PlatformAction }): Promise<void>;
};

export type Ports = {
  /** Runs `work` in one transaction scoped to `workspaceId` (row-level security, ADR-005). */
  inWorkspace<T>(workspaceId: string, work: (store: WorkspaceStore) => Promise<T>): Promise<T>;
  newId(): string;
};

export type CreateWorkspaceInput = {
  name: string;
  company: string;
  // shortcut: unchecked here, the web form validates it; the job-types catalogue (AIV-P1-004) owns the values.
  hiringFocus: string;
  synthetic?: boolean;
  /**
   * A sign-up while the pilot needs approval (AIV-P2-039): the workspace starts `pending_approval` and takes no new
   * work until an operator approves it. The seed and tests leave it out: active at once.
   */
  needsApproval?: boolean;
  /** The signed-in user, from the request context; becomes the workspace's first admin. */
  creatorUserId: string;
};

export type ChangeRoleInput = { workspaceId: string; actorUserId: string; targetUserId: string; role: Role };

export function workspacesUseCases({ inWorkspace, newId }: Ports) {
  return {
    createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
      const id = newId();
      return inWorkspace(id, async (store) => {
        const { creatorUserId, synthetic = false, needsApproval = false, ...fields } = input;
        const status = needsApproval ? 'pending_approval' : 'active';
        // Every workspace starts as an in-house team; an admin makes it an agency with setWorkspaceType.
        const workspace = await store.insertWorkspace({ id, type: 'in_house', ...fields, synthetic, status });
        await store.insertMember({ workspaceId: id, userId: creatorUserId, role: 'admin', status: 'active' });
        // The creator lands in the new workspace (AIV-P0-010).
        await store.setActiveWorkspace(creatorUserId, id);
        await store.audit(id, creatorUserId, { action: 'workspace.created', subject: { type: 'workspace', id } });
        return workspace;
      });
    },

    async getMembership(userId: string, workspaceId: string): Promise<Member | null> {
      const found = await inWorkspace(workspaceId, (store) => store.findMember(workspaceId, userId));
      // Invited and removed members get null, so a caller's `!= null` check is a safe authorisation check.
      return found?.status === 'active' ? found : null;
    },

    changeRole({ workspaceId, actorUserId, targetUserId, role }: ChangeRoleInput): Promise<void> {
      return inWorkspace(workspaceId, async (store) => {
        const members = await store.lockMembers(workspaceId);
        assertCanChangeRole(members, actorUserId, targetUserId, role);
        await store.updateRole(workspaceId, targetUserId, role);
        // Admins and recruiters see every job, so their grants go; a job-scoped role starts with none.
        const revoked = JOB_SCOPED_ROLES.includes(role) ? [] : await store.deleteGrantsOf(workspaceId, targetUserId);
        for (const grant of revoked)
          await store.audit(workspaceId, actorUserId, {
            action: 'job_access.revoked',
            subject: { type: 'member', id: targetUserId },
            before: { grantId: grant.id, jobId: grant.jobId, clientId: grant.clientId },
          });
        await store.audit(workspaceId, actorUserId, {
          action: 'member.role_changed',
          subject: { type: 'member', id: targetUserId },
          before: { role: members.find((m) => m.userId === targetUserId)?.role ?? null },
          after: { role },
        });
      });
    },
  };
}
