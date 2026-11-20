import type { Tx } from '@credalent/db/client';
import { and, eq } from 'drizzle-orm';
import type { IntakeStore } from '../application/applications.ts';
import { application, applicationSource } from './schema.ts';

/**
 * The intake store over a workspace-scoped transaction. The `workspace_id` filter here is the first layer; row-level
 * security on the transaction's `app.workspace_id` is the second (ADR-005).
 */
export function intakeStore(tx: Tx): IntakeStore {
  return {
    async insertOrGetApplication(values) {
      // ON CONFLICT waits for a concurrent insert of the same person and job, so two arrivals at once share one row.
      const [inserted] = await tx.insert(application).values(values).onConflictDoNothing().returning();
      if (inserted) return inserted;
      const [existing] = await tx
        .select()
        .from(application)
        .where(
          and(
            eq(application.workspaceId, values.workspaceId),
            eq(application.personId, values.personId),
            eq(application.jobId, values.jobId),
          ),
        );
      if (!existing) throw new Error('application conflict but no application for this person and job');
      return existing;
    },
    async insertSource(values) {
      await tx.insert(applicationSource).values(values);
    },
  };
}
