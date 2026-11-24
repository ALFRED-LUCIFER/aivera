import type { Tx } from '@credalent/db/client';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { AssessmentStore } from '../application/assessment.ts';
import type { ExplanationStore } from '../application/explain.ts';
import { explanation, interviewChange, result } from './schema.ts';

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
    async byId(workspaceId, id) {
      const [row] = await tx
        .select()
        .from(result)
        .where(and(eq(result.workspaceId, workspaceId), eq(result.id, id)));
      return row ?? null;
    },
    interviewChanges(workspaceId, candidateId, jobId) {
      return tx
        .select({
          competencyId: interviewChange.competencyId,
          sourceId: interviewChange.sourceId,
          strength: interviewChange.strength,
          level: interviewChange.level,
          itemIds: interviewChange.itemIds,
        })
        .from(interviewChange)
        .where(
          and(
            eq(interviewChange.workspaceId, workspaceId),
            eq(interviewChange.candidateId, candidateId),
            eq(interviewChange.jobId, jobId),
          ),
        )
        .orderBy(asc(interviewChange.appliedAt), asc(interviewChange.id));
    },
    async insertInterviewChanges(rows) {
      await tx.insert(interviewChange).values(rows);
    },
    async appliedResult(workspaceId, candidateId, jobId, idempotencyKey) {
      const [row] = await tx
        .select({ result })
        .from(interviewChange)
        .innerJoin(result, and(eq(result.id, interviewChange.resultId), eq(result.workspaceId, workspaceId)))
        .where(
          and(
            eq(interviewChange.workspaceId, workspaceId),
            eq(interviewChange.candidateId, candidateId),
            eq(interviewChange.jobId, jobId),
            eq(interviewChange.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      return row?.result ?? null;
    },
    listForJob(workspaceId, jobId) {
      return tx
        .select()
        .from(result)
        .where(and(eq(result.workspaceId, workspaceId), eq(result.jobId, jobId)))
        .orderBy(asc(result.assessedAt), asc(result.id));
    },
    async assessedOnVersions(workspaceId, versions) {
      if (versions.length === 0) return new Map();
      const pairs = sql.join(
        versions.map((v) => sql`(${v.jobId}::uuid, ${v.rubricVersionId}::uuid)`),
        sql`, `,
      );
      const rows = await tx
        .selectDistinct({ jobId: result.jobId, candidateId: result.candidateId })
        .from(result)
        .where(
          and(eq(result.workspaceId, workspaceId), sql`(${result.jobId}, ${result.rubricVersionId}) in (${pairs})`),
        );
      const assessed = new Map<string, string[]>();
      for (const r of rows) assessed.set(r.jobId, [...(assessed.get(r.jobId) ?? []), r.candidateId]);
      return assessed;
    },
  };
}

/** The explanation cache over a workspace-scoped transaction: the same two layers as `assessmentStore`. */
export function explanationStore(tx: Tx): ExplanationStore {
  return {
    async get(workspaceId, resultId, promptVersion) {
      const [row] = await tx
        .select({ statements: explanation.statements })
        .from(explanation)
        .where(
          and(
            eq(explanation.workspaceId, workspaceId),
            eq(explanation.resultId, resultId),
            eq(explanation.promptVersion, promptVersion),
          ),
        );
      return row?.statements ?? null;
    },
    async put(row) {
      // Two requests may explain the same snapshot at once: the first answer stands, the other is dropped.
      await tx.insert(explanation).values(row).onConflictDoNothing();
    },
  };
}
