import { getIdentity } from '@/server/auth';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import { rubricView, type RubricView } from '../domain/rubric.ts';

/**
 * The rubric page (AIV-P1-012): every version through `listRubricVersions`, which checks `job.view` and the member's
 * job scope, with approvers' names. Null when the job is not visible or there is no workspace.
 */
export async function loadRubric(jobId: string): Promise<RubricView | null> {
  const result = await inActiveWorkspace((ctx) => getJobs().listRubricVersions(ctx, jobId));
  if (!result?.value) return null;
  const approvers = [...new Set(result.value.flatMap((v) => v.approvedBy ?? []))];
  const names = new Map(
    await Promise.all(
      approvers.map(async (id) => {
        const user = await getIdentity().getUser(id);
        return [id, user ? (user.displayName ?? user.email) : ''] as const;
      }),
    ),
  );
  return rubricView(result.value, names);
}
