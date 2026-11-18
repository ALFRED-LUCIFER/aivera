// The only public surface of @aivera/workspaces (ADR-002).
import type { ChangeRoleInput, CreateWorkspaceInput } from '../application/workspaces.ts';
import type { Member, Workspace } from '../domain/workspace.ts';

export { ROLES, MEMBER_STATUSES, WorkspaceError } from '../domain/workspace.ts';
export type { Member, MemberStatus, Role, Workspace, WorkspaceErrorCode } from '../domain/workspace.ts';
export type { ChangeRoleInput, CreateWorkspaceInput } from '../application/workspaces.ts';

/** Workspace ids come from the request context, never from client input (ADR-005). */
export interface WorkspacesContract {
  /** Creates the workspace and makes the creator its active admin, in one transaction. */
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  /** The user's active membership of the workspace; null when they are not a member, or are invited or removed. */
  getMembership(userId: string, workspaceId: string): Promise<Member | null>;
  listMembers(workspaceId: string): Promise<Member[]>;
  /** Admins only; refuses to remove the last admin. Throws `WorkspaceError` (`forbidden`, `not_found`, `last_admin`). */
  changeRole(input: ChangeRoleInput): Promise<void>;
}
