import type { Tx } from '@credalent/db/client';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { AssessmentStore } from '../application/assessment.ts';
import { result } from './schema.ts';

/**
 * The assessment store over a workspace-scoped transaction. The `workspace_id` filter here is the first layer;
 * row-level security on the transaction's `app.workspace_id` is the second (ADR-005).
 */
// shortcut: no delete path for results yet (0001_force_rls.sql): the demo reset (`pnpm db:seed --reset`) leaves a purged
// job's results behind, unread since the ranking reads by job id; erasure (AIV-P3-014) adds the delete with the reset.
export function assessmentStore(tx: Tx): AssessmentStore {
  return {
    async lock(workspaceId, candidateId, jobId) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`assessment:${workspaceId}:${candidateId}:${jobId}`}))`,
      );
    },
    async latest(workspaceId, candidateId, jobId) {
      const [row] = await tx
        .select()
        .from(result)
        .where(and(eq(result.workspaceId, workspaceId), eq(result.candidateId, candidateId), eq(result.jobId, jobId)))
        .orderBy(desc(result.assessedAt), desc(result.id))
        .limit(1);
      return row ?? null;
    },
    async insert(row) {
      await tx.insert(result).values(row);
    },
    listForJob(workspaceId, jobId) {
      return tx
        .select()
        .from(result)
        .where(and(eq(result.workspaceId, workspaceId), eq(result.jobId, jobId)))
        .orderBy(asc(result.assessedAt), asc(result.id));
    },
    async countOnVersions(workspaceId, versions) {
      if (versions.length === 0) return new Map();
      const pairs = sql.join(
        versions.map((v) => sql`(${v.jobId}::uuid, ${v.rubricVersionId}::uuid)`),
        sql`, `,
      );
      const rows = await tx
        .select({ jobId: result.jobId, assessed: sql<number>`count(distinct ${result.candidateId})::int` })
        .from(result)
        .where(
          and(eq(result.workspaceId, workspaceId), sql`(${result.jobId}, ${result.rubricVersionId}) in (${pairs})`),
        )
        .groupBy(result.jobId);
      return new Map(rows.map((r) => [r.jobId, r.assessed]));
    },
  };
}
