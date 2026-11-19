import type { AuditContract } from '@aivera/audit';
import { createAudit } from '@aivera/audit/composition';
import type { JobCounts } from '@aivera/jobs';
import { createJobCounts } from '@aivera/jobs/composition';
import type { DirectorySearch, WorkspaceDirectory, WorkspaceSummary } from '@aivera/workspaces';
import { createWorkspaceDirectory } from '@aivera/workspaces/composition';
import { forbidden, redirect } from 'next/navigation';
import { cache } from 'react';
import { getIdentity, getSessionUserId } from './auth';
import { getDb } from './db';
import { env } from './env';

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

let reads: { workspaces: WorkspaceDirectory; jobs: JobCounts } | undefined;
// The console's metadata reads (ADR-012 point 6): only this file wires them to the pool (ops-metadata-contracts-only).
const opsReads = () => (reads ??= { workspaces: createWorkspaceDirectory(getDb()), jobs: createJobCounts(getDb()) });

/** A workspace's platform facts with its job count: metadata only, never a member or candidate (ADR-012 point 7). */
export type WorkspaceFacts = WorkspaceSummary & { jobs: number };

const withJobs = async (summary: WorkspaceSummary): Promise<WorkspaceFacts> => ({
  ...summary,
  jobs: await opsReads().jobs.countJobs(summary.id),
});

/** One page of the workspaces list. Checks the policy itself too, so no caller can skip it. */
export async function listWorkspaceFacts(search: DirectorySearch): Promise<{ total: number; rows: WorkspaceFacts[] }> {
  await platformOperator();
  const { total, summaries } = await opsReads().workspaces.listSummaries(search);
  return { total, rows: await Promise.all(summaries.map(withJobs)) };
}

/** One workspace's facts, or null when there is none. Checks the policy itself too. */
export async function getWorkspaceFacts(workspaceId: string): Promise<WorkspaceFacts | null> {
  await platformOperator();
  const summary = await opsReads().workspaces.getSummary(workspaceId);
  return summary && withJobs(summary);
}
