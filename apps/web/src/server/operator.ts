import type { AuditContract } from '@aivera/audit';
import { createAudit } from '@aivera/audit/composition';
import type { JobCounts } from '@aivera/jobs';
import { log } from '@aivera/observability';
import { createJobCounts } from '@aivera/jobs/composition';
import {
  STATUS_CHANGES,
  type AiBudgetConsole,
  type AiTokenUse,
  type DirectorySearch,
  type StatusChange,
  type WorkspaceDirectory,
  type WorkspaceSummary,
} from '@aivera/workspaces';
import { createAiBudgetConsole, createWorkspaceDirectory } from '@aivera/workspaces/composition';
import { forbidden, redirect } from 'next/navigation';
import { cache } from 'react';
import { getIdentity, getSessionUserId } from './auth';
import { getDb } from './db';
import { env } from './env';
import { getJobs } from './jobs';
import { getPlatformSettings } from './platformSettings';
import { getWorkspaces } from './workspace';

// The platformOperator policy (AIV-P2-035, ADR-012): the operator console at /ops is for the people who run Aivera,
// named in PLATFORM_OPERATOR_EMAILS. It is not a workspace role and grants nothing inside any workspace.

/**
 * Whether the identity user's stored email (verified and lower-case, ADR-009 point 4) is a configured operator. Read on
 * every call, never cached in the session, so an email removed from the list stops working on the next request.
 */
export async function isPlatformOperator(userId: string): Promise<boolean> {
  const operators = env().platformOperators;
  // No list, an empty list or an invalid one: nobody is an operator (fails closed), and no database read is needed.
  if (operators.size === 0) return false;
  const user = await getIdentity().getUser(userId);
  return user !== null && operators.has(user.email);
}

/**
 * The policy every /ops page, layout, server action and route handler awaits before anything else (architecture-test
 * enforced). No session goes to sign-in and back to /ops; a signed-in non-operator gets the 403 page, or a 403 from an
 * action or route handler, and nothing of the console. Memoised for one request only (layout, page and metadata share
 * one check); every new request checks again.
 */
export const platformOperator = cache(async (): Promise<{ userId: string }> => {
  const userId = await getSessionUserId();
  // signInPath('/ops', '') as a literal, which typed routes accept; a deeper /ops path keeps its own return in the proxy.
  if (!userId) redirect('/sign-in?next=%2Fops');
  if (!(await isPlatformOperator(userId))) forbidden();
  return { userId };
});

let audit: AuditContract | undefined;
/** The audit module for operator actions: `recordPlatform`, and `record` inside the target workspace (ADR-012). */
export const getAudit = (): AuditContract => (audit ??= createAudit(getDb()));

let reads: { workspaces: WorkspaceDirectory; jobs: JobCounts; ai: AiBudgetConsole } | undefined;
// The console's metadata reads (ADR-012 point 6): only this file wires them to the pool (ops-metadata-contracts-only).
const opsReads = () =>
  (reads ??= {
    workspaces: createWorkspaceDirectory(getDb()),
    jobs: createJobCounts(getDb()),
    ai: createAiBudgetConsole(getDb(), getAudit()),
  });

/**
 * A workspace's platform facts with its job count and AI token use: metadata only, never a member or candidate
 * (ADR-012 point 7). `ai` is null when the usage store cannot be read ("Not yet available", AGENTS.md 1.7).
 */
type WorkspaceFacts = WorkspaceSummary & { jobs: number; ai: AiTokenUse | null };

// The UTC day on the server's clock, the same day the AI client charges (packages/ai client.ts).
const utcToday = () => new Date().toISOString().slice(0, 10);

const withFacts = async (summary: WorkspaceSummary, aiDays: number): Promise<WorkspaceFacts> => {
  const [jobs, ai] = await Promise.all([
    opsReads().jobs.countJobs(summary.id),
    opsReads()
      .ai.usage(summary.id, utcToday(), aiDays)
      .catch((error: unknown) => {
        // The error type only: a database error can quote parameters (AGENTS.md 1.2).
        log.warn(
          { area: 'ops', 'error.type': error instanceof Error ? error.name : 'unknown' },
          'ai usage unavailable',
        );
        return null;
      }),
  ]);
  return { ...summary, jobs, ai };
};

/** One page of the workspaces list, with today's AI tokens. Checks the policy itself too, so no caller can skip it. */
export async function listWorkspaceFacts(search: DirectorySearch): Promise<{ total: number; rows: WorkspaceFacts[] }> {
  await platformOperator();
  const { total, summaries } = await opsReads().workspaces.listSummaries(search);
  return { total, rows: await Promise.all(summaries.map((summary) => withFacts(summary, 1))) };
}

/** One workspace's facts with its last 7 UTC days of AI tokens, or null when there is none. Checks the policy too. */
export async function getWorkspaceFacts(workspaceId: string): Promise<WorkspaceFacts | null> {
  await platformOperator();
  const summary = await opsReads().workspaces.getSummary(workspaceId);
  return summary && withFacts(summary, 7);
}

/**
 * Sets a workspace's daily AI budget (null: the platform default), audited with the operator from the session in the
 * platform log and the workspace's (AIV-P2-038). Checks the policy itself too. Input is validated by the caller.
 */
export async function setWorkspaceAiBudget(input: {
  workspaceId: string;
  dailyBudget: number | null;
  reason: string;
}): Promise<void> {
  const { userId } = await platformOperator();
  await opsReads().ai.setDailyBudget({ operatorId: userId, ...input });
}

type OperatorActionName = (typeof STATUS_CHANGES)[StatusChange]['action'] | 'ai_budget.changed';
const OPERATOR_ACTIONS: readonly string[] = [
  ...Object.values(STATUS_CHANGES).map((c) => c.action),
  'ai_budget.changed',
];
const isOperatorAction = (action: string): action is OperatorActionName => OPERATOR_ACTIONS.includes(action);

/** An operator's action on a workspace, as its detail page lists it: what, when and the operator's reason. */
export type OperatorAction = { action: OperatorActionName; occurredAt: Date; reason: string | null };

/**
 * The status and AI budget changes operators made to a workspace, oldest first, from its own audit log (`listOperatorEntries`, read
 * inside withWorkspace(<it>) as the app role, ADR-012 points 6 and 8). Never a member's entry. Checks the policy too.
 */
export async function listOperatorActions(workspaceId: string): Promise<OperatorAction[]> {
  await platformOperator();
  const entries = await getAudit().listOperatorEntries(workspaceId);
  return entries.flatMap(({ action, occurredAt, note }) =>
    isOperatorAction(action) ? [{ action, occurredAt, reason: note }] : [],
  );
}

/**
 * Suspends or reactivates a workspace (AIV-P2-037) as the signed-in operator: through the workspaces contract inside
 * withWorkspace(<it>), with its public listings hidden or shown in the same transaction, and audited in both logs.
 * Checks the policy itself too. Throws `WorkspaceError` from the contract.
 */
export async function applyStatusChange(workspaceId: string, change: StatusChange, reason: string) {
  const { userId } = await platformOperator();
  // Approve and reject touch no listing: a workspace waiting for approval could never publish one.
  const pause = change === 'suspend' ? true : change === 'reactivate' ? false : null;
  await getWorkspaces().changeStatus(
    { operatorId: userId, workspaceId, change, reason },
    pause === null ? undefined : (tx) => getJobs().pausePublicListings(tx, workspaceId, pause),
  );
}

/** A workspace waiting for approval with its creator's email (a recruiter's, so the operator can contact them). */
export type PendingApprovalFacts = Pick<WorkspaceSummary, 'id' | 'name' | 'type' | 'createdAt'> & {
  creatorEmail: string | null;
};

/**
 * Workspaces waiting for approval, oldest first (AIV-P2-039): metadata and the creator's email, never a member list or
 * candidate data. Checks the policy itself too.
 */
export async function listPendingApprovals(): Promise<PendingApprovalFacts[]> {
  await platformOperator();
  const pending = await opsReads().workspaces.listPending();
  return Promise.all(
    pending.map(async ({ summary: { id, name, type, createdAt }, creatorUserId }) => ({
      id,
      name,
      type,
      createdAt,
      creatorEmail: creatorUserId ? ((await getIdentity().getUser(creatorUserId))?.email ?? null) : null,
    })),
  );
}

/** Whether new sign-ups wait for approval, for the approvals page. Checks the policy itself too. */
export async function approvalRequired(): Promise<boolean> {
  await platformOperator();
  return getPlatformSettings().approvalRequired();
}

/** Turns the approval switch on or off as the signed-in operator, audited in the platform log (AIV-P2-039). */
export async function setApprovalRequired(required: boolean, reason: string): Promise<void> {
  const { userId } = await platformOperator();
  await getPlatformSettings().setApprovalRequired({ operatorId: userId, required, reason });
}
