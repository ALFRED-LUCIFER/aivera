// The only public surface of @aivera/workspaces (ADR-002).
import type { Tx } from '@aivera/db/client';
import type { Session, WorkspaceContext as Context } from '../application/context.ts';
import type { ChangeRoleInput, CreateWorkspaceInput } from '../application/workspaces.ts';
import type { Action, JobResource } from '../domain/permissions.ts';
import type { GrantJobAccessInput } from '../application/clients.ts';
import type { Client, JobGrant, Member, Role, Workspace, WorkspaceType } from '../domain/workspace.ts';

export { ROLES, MEMBER_STATUSES, WorkspaceError } from '../domain/workspace.ts';
export type {
  Client,
  JobGrant,
  Member,
  MemberStatus,
  Role,
  Workspace,
  WorkspaceErrorCode,
  WorkspaceType,
} from '../domain/workspace.ts';
export type { GrantJobAccessInput } from '../application/clients.ts';
export { ForbiddenError } from '../domain/permissions.ts';
export type { Action, JobResource } from '../domain/permissions.ts';
export type { Session } from '../application/context.ts';
export type { ChangeRoleInput, CreateWorkspaceInput } from '../application/workspaces.ts';

/** `{ userId, workspaceId, role, tx }`. Module repositories take this scoped `tx`, never the pool (AIV-P0-010). */
export type WorkspaceContext = Context<Tx>;

/**
 * Input plus output AI tokens per workspace and UTC day (`YYYY-MM-DD`), shared by every process (AIV-P0-033). The store
 * behind `@aivera/ai`'s daily budget; apps wire it into `createAiClient`. Server-side only: the workspace id comes from
 * the caller's checked context or job envelope, and each call runs in that workspace's scoped transaction.
 * Mirrors `@aivera/ai`'s `TokenBudgetStore` structurally, so this module needs no dependency on the AI package.
 */
export interface AiTokenBudget {
  /** Tokens the workspace has spent on `day`; 0 when it has made no call that day. */
  spentToday(workspaceId: string, day: string): Promise<number>;
  /** Adds `tokens` to the workspace's `day` in one atomic statement. */
  add(workspaceId: string, day: string, tokens: number): Promise<void>;
}

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

  // Workspace type, agency clients and job grants (AIV-P0-906). Each takes the request context, refuses with
  // `ForbiddenError` by role and with `WorkspaceError` by rule, and audits every write in the same transaction.
  /** Admins. Throws `has_clients` for an agency whose clients are not all archived. */
  setWorkspaceType(ctx: WorkspaceContext, type: WorkspaceType): Promise<void>;
  /** Admins and recruiters; archived clients included. */
  listClients(ctx: WorkspaceContext): Promise<Client[]>;
  /** Admins and recruiters of an agency. Throws `not_agency`, `client_name` or `client_exists` (any letter case). */
  addClient(ctx: WorkspaceContext, name: string): Promise<Client>;
  /** Admins and recruiters. Throws `client_not_found`, `client_name` or `client_exists`. */
  renameClient(ctx: WorkspaceContext, clientId: string, name: string): Promise<void>;
  /** Admins and recruiters. Throws `client_not_found`. */
  archiveClient(ctx: WorkspaceContext, clientId: string): Promise<void>;
  /** Admins. The member must be an active hiring owner or interviewer (`grant_role`, `not_found`). Idempotent. */
  grantJobAccess(ctx: WorkspaceContext, input: GrantJobAccessInput): Promise<void>;
  /** Admins. Takes effect on the member's next request. Idempotent. */
  revokeJobAccess(ctx: WorkspaceContext, grantId: string): Promise<void>;
  /** Admins and recruiters: every job grant in the workspace. */
  listJobGrants(ctx: WorkspaceContext): Promise<JobGrant[]>;

  /** The user's active workspace id, or null when they have none yet. */
  activeWorkspace(userId: string): Promise<string | null>;
  /** Re-checks membership; throws `ForbiddenError` and keeps the current active workspace when refused. */
  switchWorkspace(session: Session, workspaceId: string): Promise<void>;

  // The demo seed (AIV-P0-031). Both throw `WorkspaceError('not_synthetic')` unless the workspace is flagged synthetic.
  /** Admins. Adds the user as an active member with `role`, without an invitation. Idempotent. */
  addSyntheticMember(ctx: WorkspaceContext, userId: string, role: Role): Promise<void>;
  /** Admins. Deletes the workspace and its members, clients and grants; other modules purge first in `ctx.tx`. */
  purgeSyntheticWorkspace(ctx: WorkspaceContext): Promise<void>;
}
