import type { Tx } from '@credalent/db/client';
import { and, desc, eq } from 'drizzle-orm';
import type { AssessmentStore } from '../application/assessment.ts';
import { result } from './schema.ts';

/**
 * The assessment store over a workspace-scoped transaction. The `workspace_id` filter here is the first layer;
 * row-level security on the transaction's `app.workspace_id` is the second (ADR-005).
 */
export function assessmentStore(tx: Tx): AssessmentStore {
  return {
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
  };
}
