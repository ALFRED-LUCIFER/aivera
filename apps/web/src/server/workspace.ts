import { createAudit } from '@aivera/audit/composition';
import { createIdentity } from '@aivera/identity/composition';
import {
  ForbiddenError,
  type Action,
  type JobResource,
  type WorkspaceContext,
  type WorkspacesContract,
} from '@aivera/workspaces';
import { createWorkspaces } from '@aivera/workspaces/composition';
import { forbidden, redirect } from 'next/navigation';
import { cache } from 'react';
import { getSessionUserId } from './auth';
import { getDb } from './db';

// The request context (AIV-P0-010, ADR-005): every server action, route handler and recruiter page runs in the
// signed-in user's active workspace, which is held server-side. The browser never names the workspace.

let workspaces: WorkspacesContract | undefined;
export const getWorkspaces = () => (workspaces ??= createWorkspaces(getDb(), createAudit(getDb())));

/**
 * Runs `fn` in the signed-in user's active workspace. No session goes to sign-in; no active workspace yet gives
 * null; not an active member there (removed, forged) renders the 403 page.
 */
export async function inActiveWorkspace<T>(fn: (ctx: WorkspaceContext) => Promise<T>): Promise<{ value: T } | null> {
  const userId = await getSessionUserId();
  if (!userId) redirect('/sign-in');
  const workspaceId = await getWorkspaces().activeWorkspace(userId);
  if (!workspaceId) return null;
  try {
    return { value: await getWorkspaces().withWorkspace({ userId }, workspaceId, fn) };
  } catch (error) {
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

/**
 * Wraps a server action or route handler: the active workspace's context, then `authorize(action, resource)`, then
 * `handler`. A refusal renders the 403 page ("You do not have access to this. Ask your workspace admin.").
 * `resource` names the record's job for job-scoped actions; it comes from the validated input, never from the role.
 */
export function workspaceAction<Input, Result>(
  action: Action,
  handler: (ctx: WorkspaceContext, input: Input) => Promise<Result>,
  options: { resource?: (input: Input) => JobResource } = {},
): (input: Input) => Promise<Result> {
  return async (input) => {
    const result = await inActiveWorkspace(async (ctx) => {
      await getWorkspaces().authorize(ctx, action, options.resource?.(input));
      return handler(ctx, input);
    });
    if (!result) forbidden();
    return result.value;
  };
}

/** The signed-in member as the shell shows them, or null when they belong to no workspace yet. Once per request. */
export const currentMembership = cache(async () => {
  const result = await inActiveWorkspace(async ({ userId, workspaceId, role }) => ({ userId, workspaceId, role }));
  if (!result) return null;
  const { userId, workspaceId, role } = result.value;
  const [user, workspace] = await Promise.all([
    createIdentity(getDb()).getUser(userId),
    getWorkspaces().getWorkspace(workspaceId),
  ]);
  if (!user || !workspace) forbidden();
  return { name: user.displayName ?? user.email, role, synthetic: workspace.synthetic };
});
