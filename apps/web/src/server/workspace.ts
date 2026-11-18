import { createAudit } from '@aivera/audit/composition';
import {
  ForbiddenError,
  type Action,
  type JobResource,
  type WorkspaceContext,
  type WorkspacesContract,
} from '@aivera/workspaces';
import { annotateSpan, withSpan } from '@aivera/observability';
import { createWorkspaces } from '@aivera/workspaces/composition';
import { forbidden, redirect } from 'next/navigation';
import { cache } from 'react';
import type { z } from 'zod';
import { getIdentity, getSessionUserId } from './auth';
import { getDb } from './db';

// The request context (AIV-P0-010, ADR-005): every server action, route handler and recruiter page runs in the
// signed-in user's active workspace, which is held server-side. The browser never names the workspace.

let workspaces: WorkspacesContract | undefined;
export const getWorkspaces = (): WorkspacesContract => (workspaces ??= createWorkspaces(getDb(), createAudit(getDb())));

/**
 * Runs `fn` in the signed-in user's active workspace. No session goes to sign-in; no active workspace yet gives
 * null; not an active member there (removed, forged) renders the 403 page.
 */
export async function inActiveWorkspace<T>(fn: (ctx: WorkspaceContext) => Promise<T>): Promise<{ value: T } | null> {
  const userId = await getSessionUserId();
  if (!userId) redirect('/sign-in');
  const workspaceId = await getWorkspaces().activeWorkspace(userId);
  if (!workspaceId) return null;
  // Opaque ids only on telemetry (AGENTS.md 1.2): the workspace, never the user's email.
  annotateSpan({ 'workspace.id': workspaceId });
  try {
    return { value: await getWorkspaces().withWorkspace({ userId }, workspaceId, fn) };
  } catch (error) {
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

/**
 * Wraps a server action or route handler: validate the input with `input` (AGENTS.md 3.7), open the active workspace's
 * context, `authorize(action, resource)`, then run `handler`. A refusal renders the 403 page ("You do not have access
 * to this. Ask your workspace admin."). For a job-scoped action `resource` loads the job of the stored record through
 * `ctx.tx`; it must never take the job id from the request, or a grant on one job would open another job's records.
 */
export function workspaceAction<Input, Result>(
  action: Action,
  handler: (ctx: WorkspaceContext, input: Input) => Promise<Result>,
  options: { input: z.ZodType<Input>; resource?: (ctx: WorkspaceContext, input: Input) => Promise<JobResource> },
): (input: Input) => Promise<Result> {
  return (raw) =>
    withSpan(`action ${action}`, {}, async () => {
      const input = options.input.parse(raw);
      const result = await inActiveWorkspace(async (ctx) => {
        await getWorkspaces().authorize(ctx, action, await options.resource?.(ctx, input));
        return handler(ctx, input);
      });
      if (!result) forbidden();
      return result.value;
    });
}

/** The signed-in member as the shell shows them, or null when they belong to no workspace yet. Once per request. */
export const currentMembership = cache(async () => {
  const result = await inActiveWorkspace(async (ctx) => ({
    userId: ctx.userId,
    role: ctx.role,
    workspace: await getWorkspaces().getWorkspace(ctx),
  }));
  if (!result) return null;
  const { userId, role, workspace } = result.value;
  const user = await getIdentity().getUser(userId);
  if (!user || !workspace) forbidden();
  return { name: user.displayName ?? user.email, role, synthetic: workspace.synthetic };
});
