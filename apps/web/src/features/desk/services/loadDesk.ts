import { getIdentity } from '@/server/auth';
import { getJobs } from '@/server/jobs';
import { getWorkspaces, inActiveWorkspace } from '@/server/workspace';
import { approvalItems, toApproveItems, type Desk } from '../domain/desk.ts';

/**
 * My desk: the rubrics waiting for your approval (AIV-P1-084, admins and recruiters only, ADR-014) and the rubric
 * approvals waiting on others (AIV-P1-014) through `listRubricApprovals`, which checks `job.list` and the member's job
 * scope, with each hiring owner named by their title in the workspace, else their name. Null when there is no workspace.
 */
export async function loadDesk(): Promise<Desk | null> {
  const result = await inActiveWorkspace(async (ctx) => ({
    rows: await getJobs().listRubricApprovals(ctx),
    toApprove:
      ctx.role === 'admin' || ctx.role === 'recruiter'
        ? toApproveItems(await getJobs().listRubricsToApprove(ctx))
        : null,
    workspaceId: ctx.workspaceId,
  }));
  if (!result) return null;
  const { rows, toApprove, workspaceId } = result.value;
  const ownerIds = [...new Set(rows.flatMap((r) => r.hiringOwnerUserId ?? []))];
  const owners = new Map(
    await Promise.all(
      ownerIds.map(async (id) => {
        const title = (await getWorkspaces().getMembership(id, workspaceId))?.title;
        const user = title ? null : await getIdentity().getUser(id);
        return [id, title || user?.displayName || user?.email || ''] as const;
      }),
    ),
  );
  return { toApprove, approvals: approvalItems(rows, owners) };
}
