// The only public surface of @aivera/workspaces (ADR-002).
import type { Tx } from '@aivera/db/client';
import type { Session, WorkspaceContext as Context } from '../application/context.ts';
import type { ChangeRoleInput, CreateWorkspaceInput } from '../application/workspaces.ts';
import type { Action, JobResource } from '../domain/permissions.ts';
import type { Member, Workspace } from '../domain/workspace.ts';

export { ROLES, MEMBER_STATUSES, WorkspaceError } from '../domain/workspace.ts';
export type { Member, MemberStatus, Role, Workspace, WorkspaceErrorCode } from '../domain/workspace.ts';
export { ForbiddenError } from '../domain/permissions.ts';
export type { Action, JobResource } from '../domain/permissions.ts';
export type { Session } from '../application/context.ts';
export type { ChangeRoleInput, CreateWorkspaceInput } from '../application/workspaces.ts';

/** `{ userId, workspaceId, role, tx }`. Module repositories take this scoped `tx`, never the pool (AIV-P0-010). */
export type WorkspaceContext = Context<Tx>;

/** Workspace ids come from the request context, never from client input (ADR-005). */
export interface WorkspacesContract {
  /** Creates the workspace, makes the creator its active admin and their active workspace, in one transaction. */
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  /** The user's active membership of the workspace; null when they are not a member, or are invited or removed. */
  getMembership(userId: string, workspaceId: string): Promise<Member | null>;
  listMembers(workspaceId: string): Promise<Member[]>;
  /** Admins only; refuses to remove the last admin. Throws `WorkspaceError` (`forbidden`, `not_found`, `last_admin`). */
  changeRole(input: ChangeRoleInput): Promise<void>;

  /** Runs `fn` in the workspace's scoped transaction if the user is an active member; otherwise `ForbiddenError`. */
  withWorkspace<T>(session: Session, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>): Promise<T>;
  /** The context's workspace, read in its checked transaction. */
  getWorkspace(ctx: WorkspaceContext): Promise<Workspace | null>;
  /** Throws `ForbiddenError` unless the role allows `action`; job-scoped roles also need a grant on `resource`. */
  authorize(ctx: WorkspaceContext, action: Action, resource?: JobResource): Promise<void>;
  /** The user's active workspace id, or null when they have none yet. */
  activeWorkspace(userId: string): Promise<string | null>;
  /** Re-checks membership; throws `ForbiddenError` and keeps the current active workspace when refused. */
  switchWorkspace(session: Session, workspaceId: string): Promise<void>;
}
