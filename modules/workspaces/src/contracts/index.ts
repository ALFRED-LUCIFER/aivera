// The only public surface of @credalent/workspaces (ADR-002).
import type { Tx } from '@credalent/db/client';
import type { Session, WorkspaceContext as Context } from '../application/context.ts';
import type { ChangeRoleInput, CreateWorkspaceInput } from '../application/workspaces.ts';
import type { Action, JobResource } from '../domain/permissions.ts';
import type { GrantJobAccessInput, SetJobOwnerInput } from '../application/clients.ts';
import type { DirectorySearch, PendingApproval } from '../application/directory.ts';
import type { ChangeStatusInput } from '../application/status.ts';
import type { SettingsPatch, WorkspaceSettings } from '../domain/settings.ts';
import type { InvitationView, InviteMemberInput, JobAccess } from '../application/invitations.ts';
import type { Invitation } from '../domain/invitation.ts';
import type {
  AiTokenUse,
  Client,
  JobGrant,
  Member,
  Role,
  Workspace,
  WorkspaceSummary,
  WorkspaceStatusFact,
  WorkspaceType,
} from '../domain/workspace.ts';

export {
  AI_DAILY_TOKEN_BUDGET,
  ROLES,
  MEMBER_STATUSES,
  MIN_REASON_LENGTH,
  STATUS_CHANGES,
  WORKSPACE_STATUSES,
  WorkspaceError,
} from '../domain/workspace.ts';
export type {
  AiTokenUse,
  Client,
  JobGrant,
  Member,
  MemberStatus,
  Role,
  StatusChange,
  Workspace,
  WorkspaceErrorCode,
  WorkspaceStatus,
  WorkspaceStatusFact,
  WorkspaceSummary,
  WorkspaceType,
} from '../domain/workspace.ts';
export type { ChangeStatusInput } from '../application/status.ts';
export type { InvitationView, InviteMemberInput, JobAccess } from '../application/invitations.ts';
export { invitationState } from '../domain/invitation.ts';
export type { Invitation, InvitationState } from '../domain/invitation.ts';
export type { DirectorySearch, PendingApproval } from '../application/directory.ts';
export type { GrantJobAccessInput, SetJobOwnerInput } from '../application/clients.ts';
export {
  DEFAULT_SETTINGS,
  SETTING_BOUNDS,
  SettingsError,
  settingsPatchSchema,
  settingsSchema,
} from '../domain/settings.ts';
export type { NumberSetting, SettingsPatch, WorkspaceSettings } from '../domain/settings.ts';
export { ForbiddenError, WorkspacePausedError } from '../domain/permissions.ts';
export type { Action, JobResource } from '../domain/permissions.ts';
export type { Session } from '../application/context.ts';
export type { ChangeRoleInput, CreateWorkspaceInput } from '../application/workspaces.ts';

/** `{ userId, workspaceId, role, tx }`. Module repositories take this scoped `tx`, never the pool (AIV-P0-010). */
export type WorkspaceContext = Context<Tx>;

/**
 * Input plus output AI tokens per workspace and UTC day (`YYYY-MM-DD`), shared by every process (AIV-P0-033). The store
 * behind `@credalent/ai`'s daily budget; apps wire it into `createAiClient`. Server-side only: the workspace id comes from
 * the caller's checked context or job envelope, and each call runs in that workspace's scoped transaction.
 * Mirrors `@credalent/ai`'s `TokenBudgetStore` structurally, so this module needs no dependency on the AI package.
 */
export interface AiTokenBudget {
  /**
   * Tokens the workspace has spent on `day` (0 when it has made no call that day) and its daily budget in force: an
   * operator's override, or `AI_DAILY_TOKEN_BUDGET.default` (AIV-P2-038). One read, so the two agree.
   */
  spentToday(workspaceId: string, day: string): Promise<{ spent: number; limit: number }>;
  /** Adds `tokens` to the workspace's `day` in one atomic statement. */
  add(workspaceId: string, day: string, tokens: number): Promise<void>;
}

/**
 * The operator console's workspace reads (ADR-012 point 6), for `/ops` only. Platform facts and counts, never a member,
 * a client or candidate data. Each workspace is read inside withWorkspace(<that workspace>) as the app role, under its
 * unchanged tenant policies; the list comes from the platform directory (workspace id and created date only).
 * Callers check the platformOperator policy first.
 */
export interface WorkspaceDirectory {
  /** Workspaces whose name contains `query` (any case; empty matches all), newest first, and how many match. */
  listSummaries(search: DirectorySearch): Promise<{ total: number; summaries: WorkspaceSummary[] }>;
  /** One workspace's facts; null when there is no such workspace. */
  getSummary(workspaceId: string): Promise<WorkspaceSummary | null>;
  /** Workspaces waiting for approval, oldest first, each with its creator's opaque user id (AIV-P2-039). */
  listPending(): Promise<PendingApproval[]>;
  /** Every workspace's opaque id, status and created date, for the console home's counts (AIV-P2-051). */
  listStatuses(): Promise<WorkspaceStatusFact[]>;
}

/**
 * The operator console's AI budget (AIV-P2-038, ADR-012), for `/ops` only. Each call runs inside
 * withWorkspace(<that workspace>) as the app role. Callers check the platformOperator policy first and pass the
 * operator's identity user id from the session.
 */
export interface AiBudgetConsole {
  /** The workspace's daily budget and its tokens on each of the `days` UTC days ending on `today`; null: no workspace. */
  usage(workspaceId: string, today: string, days: number): Promise<AiTokenUse | null>;
  /**
   * Sets the workspace's daily budget (`null`: back to the platform default) and records "ai_budget.changed" with the
   * old and new budget, the operator and the reason in the platform audit log and the workspace's, in the same
   * transaction. The database refuses a budget outside `AI_DAILY_TOKEN_BUDGET`'s bounds; `no_workspace` when there is
   * no such workspace. The next AI call reads it; calls in flight finish.
   */
  setDailyBudget(input: {
    operatorId: string;
    workspaceId: string;
    dailyBudget: number | null;
    reason: string;
  }): Promise<void>;
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
  /**
   * Admins and recruiters, when a job is saved with a hiring owner (AIV-P1-056): the owner gets a grant on that job and
   * the previous owner loses theirs (a client grant they hold stays). Throws `owner_role` unless the new owner is an
   * active hiring owner. Audited as `job_access.granted` / `job_access.revoked`.
   */
  setJobOwner(ctx: WorkspaceContext, input: SetJobOwnerInput): Promise<void>;
  /** Admins. Takes effect on the member's next request. Idempotent. */
  revokeJobAccess(ctx: WorkspaceContext, grantId: string): Promise<void>;
  /** Admins and recruiters: every job grant in the workspace. */
  listJobGrants(ctx: WorkspaceContext): Promise<JobGrant[]>;

  // Workspace settings (AIV-P1-051). Read at call time: a change applies to what is issued after it; links,
  // invitations and sessions already issued keep the expiry they were issued with.
  /** Every member: the stored values over the approved defaults (a workspace that changed none gets every default). */
  getSettings(ctx: WorkspaceContext): Promise<WorkspaceSettings>;
  /**
   * Admins. Validates every value against `SETTING_BOUNDS` (`SettingsError`, "clientShareLinkDays must be between 1
   * and 30", nothing saved or audited), saves, and audits `workspace.settings_changed` with each changed key's old and
   * new value, last. Returns the settings now in force; a patch that changes nothing writes nothing.
   */
  updateSettings(ctx: WorkspaceContext, patch: SettingsPatch): Promise<WorkspaceSettings>;
  // Invitations and membership (AIV-P1-003, ADR-009). Each takes the request context except the two the invitee uses
  // before they are a member; every write is audited in the same transaction.
  /**
   * Admins. Stores the invitation (open for the `invitationDays` setting, default 7) and runs `alongside(invitation, token)` in the same transaction, before the
   * audit write: the caller queues the invitation email there with the link. Only the token's hash is kept.
   * Hiring owners and interviewers need jobs or clients (`jobs_required`), admins and recruiters take none
   * (`jobs_not_allowed`); a client must be the workspace's and not archived (`client_not_found`). Job ids are not
   * checked here: the caller passes only the workspace's jobs.
   */
  inviteMember(
    ctx: WorkspaceContext,
    input: InviteMemberInput,
    alongside?: (invitation: Invitation, token: string) => Promise<void>,
  ): Promise<{ invitation: Invitation; token: string }>;
  /** Admins. Invitations neither accepted nor revoked, newest first, expired ones included. */
  listInvitations(ctx: WorkspaceContext): Promise<Invitation[]>;
  /** Admins. The link stops working at once; an accepted or revoked invitation is left as it is. */
  revokeInvitation(ctx: WorkspaceContext, invitationId: string): Promise<void>;
  /** Public: the invitation behind a link and whether it is open; null when the link matches none. */
  findInvitation(token: string): Promise<InvitationView | null>;
  /**
   * The signed-in user, whose verified email must be the invited one (`invitation_email`), joins with the invited role
   * and job grants (each audited; an archived client's is skipped) and lands in the workspace, in one transaction.
   * Throws `invitation_invalid`, `already_member`, or `WorkspacePausedError` while the workspace is not active.
   */
  acceptInvitation(user: { userId: string; email: string }, token: string): Promise<{ workspaceId: string }>;
  /** Admins. The member's grants become exactly `access` (each change audited); next request onwards. */
  changeJobAccess(ctx: WorkspaceContext, userId: string, access: JobAccess): Promise<void>;
  /** Admins. Removes the member and their grants; refuses the last admin (`last_admin`). */
  removeMember(ctx: WorkspaceContext, userId: string): Promise<void>;

  /** The user's active workspace id, or null when they have none yet. */
  activeWorkspace(userId: string): Promise<string | null>;
  /** Re-checks membership; throws `ForbiddenError` and keeps the current active workspace when refused. */
  switchWorkspace(session: Session, workspaceId: string): Promise<void>;

  // The demo seed (AIV-P0-031). Both throw `WorkspaceError('not_synthetic')` unless the workspace is flagged synthetic.
  /** Admins. Adds the user as an active member with `role`, without an invitation. Idempotent. */
  addSyntheticMember(ctx: WorkspaceContext, userId: string, role: Role): Promise<void>;
  /** Admins. Deletes the workspace and its members, clients and grants; other modules purge first in `ctx.tx`. */
  purgeSyntheticWorkspace(ctx: WorkspaceContext): Promise<void>;

  /**
   * An operator suspends or reactivates a workspace (AIV-P2-037, ADR-012 point 7). Not a member action: callers check
   * the platformOperator policy first and pass the operator's id from the session. Runs inside withWorkspace(<the
   * workspace>) as the app role, never through an RLS bypass; `alongside` runs in that transaction (another module's
   * part of the change, through its contract), and both audit writes come last. Never deletes, hides or reorders a
   * candidate. Throws `WorkspaceError` (`reason_required`, `not_found`, `status_conflict`).
   */
  changeStatus(input: ChangeStatusInput, alongside?: (tx: Tx) => Promise<void>): Promise<void>;
}
