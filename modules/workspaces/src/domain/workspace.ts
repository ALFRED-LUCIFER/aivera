// A workspace is a tenant: one hiring team. Members belong to it with a role (ADR-005).

export const ROLES = ['admin', 'recruiter', 'hiring_owner', 'interviewer'] as const;
export type Role = (typeof ROLES)[number];

export const MEMBER_STATUSES = ['invited', 'active', 'removed'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** ADR-009: an in-house team hires for itself; an agency recruits for clients. */
export const WORKSPACE_TYPES = ['in_house', 'agency'] as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

/**
 * Only an active workspace takes new work. An operator suspends one with a reason (AIV-P2-037); its members still read
 * everything, and nothing is deleted, hidden or reordered (AGENTS.md 1.5, 1.8). While the pilot needs approval, a
 * sign-up's workspace starts `pending_approval` until an operator approves (`active`) or rejects it (AIV-P2-039).
 */
export const WORKSPACE_STATUSES = ['active', 'suspended', 'pending_approval', 'rejected'] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

/** An operator's reason for a status change: at least this many characters once trimmed. */
export const MIN_REASON_LENGTH = 10;

/**
 * What an operator may do to a workspace's status, from which status to which, the audit action it records, and whether
 * it needs a reason (approving does not).
 */
export const STATUS_CHANGES = {
  suspend: { from: 'active', to: 'suspended', action: 'workspace.suspended', reason: true },
  reactivate: { from: 'suspended', to: 'active', action: 'workspace.reactivated', reason: true },
  approve: { from: 'pending_approval', to: 'active', action: 'workspace.approved', reason: false },
  reject: { from: 'pending_approval', to: 'rejected', action: 'workspace.rejected', reason: true },
} as const satisfies Record<string, { from: WorkspaceStatus; to: WorkspaceStatus; action: string; reason: boolean }>;
export type StatusChange = keyof typeof STATUS_CHANGES;

export type Workspace = {
  id: string;
  type: WorkspaceType;
  name: string;
  company: string;
  hiringFocus: string;
  /** Demo and test workspaces hold only synthetic people (AGENTS.md 1.1). */
  synthetic: boolean;
  status: WorkspaceStatus;
  createdAt: Date;
};

/**
 * A workspace's platform facts for the operator console (ADR-012 point 6): metadata and a count, never a member, a
 * client or anything about a candidate.
 */
export type WorkspaceSummary = {
  id: string;
  name: string;
  type: WorkspaceType;
  createdAt: Date;
  synthetic: boolean;
  status: WorkspaceStatus;
  /** Members whose status is active; invited and removed members are not counted. */
  activeMembers: number;
};

/** A workspace's status and created date, the console home's counts (AIV-P2-051): an opaque id, never a name. */
export type WorkspaceStatusFact = Pick<WorkspaceSummary, 'id' | 'status' | 'createdAt'>;

/**
 * Input plus output AI tokens a workspace may spend per UTC day (AIV-P0-033, AIV-P2-038): the platform default, and the
 * bounds of an operator's per-workspace override. Mirrored by `workspace_ai_daily_token_budget_check`.
 */
export const AI_DAILY_TOKEN_BUDGET = { default: 2_000_000, min: 100_000, max: 10_000_000 } as const;

/** One workspace's AI token use for the operator console: its daily budget and the tokens spent per UTC day. */
export type AiTokenUse = {
  /** The budget in force: the operator's override, or the platform default. */
  dailyBudget: number;
  /** True when an operator set `dailyBudget`; false for the platform default. */
  overridden: boolean;
  /** Tokens per UTC day (`YYYY-MM-DD`), newest (today) first, one entry per day of the window, 0 when no call. */
  days: { day: string; tokens: number }[];
};

const DAY_MS = 86_400_000;

/** The `count` UTC days ending on `today` (`YYYY-MM-DD`), newest first, with 0 tokens for a day with no use. */
export function usageWindow(today: string, count: number, used: { day: string; tokens: number }[]) {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(end - i * DAY_MS).toISOString().slice(0, 10);
    return { day, tokens: used.find((u) => u.day === day)?.tokens ?? 0 };
  });
}

export type Member = {
  userId: string;
  workspaceId: string;
  role: Role;
  status: MemberStatus;
  /** The job title shown in the app, such as "CPO, Payments"; null when none was given. */
  title: string | null;
};

/** An agency's client (ADR-005 point 6). Not a tenant: it only scopes jobs for hiring owners and interviewers. */
export type Client = { id: string; name: string; archivedAt: Date | null };

/** Access to one job, or to every current and future job of one client. Exactly one of the two is set. */
export type JobGrant = {
  id: string;
  userId: string;
  jobId: string | null;
  clientId: string | null;
  grantedBy: string;
  grantedAt: Date;
};

const MESSAGES = {
  forbidden: 'Only a workspace admin can change roles',
  not_found: 'No such member in this workspace',
  last_admin: 'A workspace needs at least one admin',
  not_agency: 'Only agency workspaces have clients.',
  has_clients: 'Archive every client before making this workspace an in-house team.',
  client_exists: 'A client with this name already exists.',
  client_name: "Enter the client's name.",
  client_not_found: 'No such client in this workspace',
  grant_role: 'Only hiring owners and interviewers get job access.',
  owner_role: 'Only an active hiring owner can be a job’s hiring owner.',
  not_synthetic: 'Only a synthetic demo workspace can be seeded or purged.',
  no_workspace: 'No such workspace',
  status_conflict: 'The workspace status has changed. Reload and try again.',
  reason_required: 'Give a reason of at least 10 characters.',
  jobs_required: 'Choose the jobs this person works on.',
  jobs_not_allowed: 'Admins and recruiters see every job; they are not given jobs.',
  invitation_invalid: 'This invitation is no longer valid. Ask your workspace admin for a new one.',
  invitation_email: 'This invitation was sent to another email address.',
  already_member: 'This person is already a member of the workspace.',
} as const;

export type WorkspaceErrorCode = keyof typeof MESSAGES;

/** A refused workspace operation. `forbidden` maps to HTTP 403 at the edge (AIV-P0-010). */
export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  constructor(code: WorkspaceErrorCode) {
    super(MESSAGES[code]);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

/**
 * Throws unless `actorUserId` may give `targetUserId` the role `role`, given every member of the workspace:
 * only an active admin changes roles, and the last active admin cannot stop being one.
 */
export function assertCanChangeRole(members: Member[], actorUserId: string, targetUserId: string, role: Role): void {
  const active = members.filter((m) => m.status === 'active');
  if (active.find((m) => m.userId === actorUserId)?.role !== 'admin') throw new WorkspaceError('forbidden');
  const target = members.find((m) => m.userId === targetUserId && m.status !== 'removed');
  if (!target) throw new WorkspaceError('not_found');
  const admins = active.filter((m) => m.role === 'admin');
  if (role !== 'admin' && admins.length === 1 && admins[0]?.userId === targetUserId)
    throw new WorkspaceError('last_admin');
}
