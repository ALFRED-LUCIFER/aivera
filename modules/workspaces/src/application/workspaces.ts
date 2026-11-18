import type { NewEntry } from '@aivera/audit';
import { assertCanChangeRole, type Member, type Role, type Workspace } from '../domain/workspace.ts';

/** The store a use case sees inside one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type WorkspaceStore = {
  insertWorkspace(workspace: Omit<Workspace, 'createdAt'>): Promise<Workspace>;
  insertMember(member: Member): Promise<void>;
  findMember(workspaceId: string, userId: string): Promise<Member | null>;
  listMembers(workspaceId: string): Promise<Member[]>;
  /** Every member, locked until commit, so two concurrent role changes cannot both remove an admin. */
  lockMembers(workspaceId: string): Promise<Member[]>;
  updateRole(workspaceId: string, userId: string, role: Role): Promise<void>;
  /** Appends an audit entry in this transaction, by a user of this workspace. */
  audit(workspaceId: string, actorUserId: string, entry: NewEntry): Promise<void>;
};

export type Ports = {
  /** Runs `work` in one transaction scoped to `workspaceId` (row-level security, ADR-005). */
  inWorkspace<T>(workspaceId: string, work: (store: WorkspaceStore) => Promise<T>): Promise<T>;
  newId(): string;
};

export type CreateWorkspaceInput = {
  name: string;
  company: string;
  hiringFocus: string;
  synthetic?: boolean;
  /** The signed-in user, from the request context; becomes the workspace's first admin. */
  creatorUserId: string;
};

export type ChangeRoleInput = { workspaceId: string; actorUserId: string; targetUserId: string; role: Role };

export function workspacesUseCases({ inWorkspace, newId }: Ports) {
  return {
    createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
      const id = newId();
      return inWorkspace(id, async (store) => {
        const { creatorUserId, synthetic = false, ...fields } = input;
        const workspace = await store.insertWorkspace({ id, ...fields, synthetic });
        await store.insertMember({ workspaceId: id, userId: creatorUserId, role: 'admin', status: 'active' });
        return workspace;
      });
    },

    async getMembership(userId: string, workspaceId: string): Promise<Member | null> {
      const found = await inWorkspace(workspaceId, (store) => store.findMember(workspaceId, userId));
      // Invited and removed members get null, so a caller's `!= null` check is a safe authorisation check.
      return found?.status === 'active' ? found : null;
    },

    listMembers(workspaceId: string): Promise<Member[]> {
      return inWorkspace(workspaceId, (store) => store.listMembers(workspaceId));
    },

    changeRole({ workspaceId, actorUserId, targetUserId, role }: ChangeRoleInput): Promise<void> {
      return inWorkspace(workspaceId, async (store) => {
        const members = await store.lockMembers(workspaceId);
        assertCanChangeRole(members, actorUserId, targetUserId, role);
        await store.updateRole(workspaceId, targetUserId, role);
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
