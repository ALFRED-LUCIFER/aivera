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
      const [inserted] = await tx
        .insert(application)
        .values(values)
        .onConflictDoNothing({ target: [application.workspaceId, application.personId, application.jobId] })
        .returning();
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
    async findSource(workspaceId, sourceId) {
      const [row] = await tx
        .select({
          personId: application.personId,
          links: applicationSource.links,
          githubLogin: applicationSource.githubLogin,
        })
        .from(applicationSource)
        .innerJoin(
          application,
          and(
            eq(application.workspaceId, applicationSource.workspaceId),
            eq(application.id, applicationSource.applicationId),
          ),
        )
        .where(and(eq(applicationSource.workspaceId, workspaceId), eq(applicationSource.id, sourceId)));
      return row ?? null;
    },
    async findApplication(workspaceId, applicationId) {
      const [row] = await tx
        .select()
        .from(application)
        .where(and(eq(application.workspaceId, workspaceId), eq(application.id, applicationId)));
      return row ?? null;
    },
  };
}

/** The jobs a person applied to, for the worker (AIV-P1-027); the workspace filter here, row-level security below. */
export const jobsForCandidate = async (tx: Tx, workspaceId: string, personId: string) =>
  (
    await tx
      .select({ jobId: application.jobId })
      .from(application)
      .where(and(eq(application.workspaceId, workspaceId), eq(application.personId, personId)))
  ).map((r) => r.jobId);

/** The people who applied to a job, for the worker (AIV-P1-027). */
export const candidatesForJob = async (tx: Tx, workspaceId: string, jobId: string) =>
  (
    await tx
      .select({ personId: application.personId })
      .from(application)
      .where(and(eq(application.workspaceId, workspaceId), eq(application.jobId, jobId)))
  ).map((r) => r.personId);
