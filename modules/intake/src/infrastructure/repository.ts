import type { Tx } from '@credalent/db/client';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { IntakeStore } from '../application/applications.ts';
import type { Source, Stage } from '../domain/application.ts';
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
          fileIds: applicationSource.fileIds,
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
    listForJob(workspaceId, jobId) {
      // One row per application: DISTINCT ON keeps its earliest source.
      return tx
        .selectDistinctOn([application.receivedAt, application.id], {
          applicationId: application.id,
          personId: application.personId,
          stage: application.stage,
          receivedAt: application.receivedAt,
          source: applicationSource.source,
        })
        .from(application)
        .innerJoin(
          applicationSource,
          and(
            eq(applicationSource.workspaceId, application.workspaceId),
            eq(applicationSource.applicationId, application.id),
          ),
        )
        .where(and(eq(application.workspaceId, workspaceId), eq(application.jobId, jobId)))
        .orderBy(
          desc(application.receivedAt),
          desc(application.id),
          asc(applicationSource.receivedAt),
          asc(applicationSource.id),
        );
    },

    async countForJob(workspaceId, jobId) {
      // The inner join drops only an application a duplicate merge emptied (AIV-P1-018), which no longer counts.
      const [row] = await tx
        .select({ total: sql<number>`count(distinct ${application.id})`.mapWith(Number) })
        .from(application)
        .innerJoin(
          applicationSource,
          and(
            eq(applicationSource.workspaceId, application.workspaceId),
            eq(applicationSource.applicationId, application.id),
          ),
        )
        .where(and(eq(application.workspaceId, workspaceId), eq(application.jobId, jobId)));
      return row?.total ?? 0;
    },
  };
}

// An application keeps at least one source, except one a duplicate merge emptied into the survivor's application for
// the same job (AIV-P1-018): kept for the undo, it is no longer an application.
const hasSource = sql`exists (select 1 from ${applicationSource} where ${applicationSource.workspaceId} = ${application.workspaceId} and ${applicationSource.applicationId} = ${application.id})`;

/** The jobs a person applied to, for the worker (AIV-P1-027); the workspace filter here, row-level security below. */
export const jobsForCandidate = async (tx: Tx, workspaceId: string, personId: string) =>
  (
    await tx
      .select({ jobId: application.jobId })
      .from(application)
      .where(and(eq(application.workspaceId, workspaceId), eq(application.personId, personId), hasSource))
      // Id order, so the assessment worker takes candidate-and-job locks in one order and never deadlocks (AIV-P1-031).
      .orderBy(application.jobId)
  ).map((r) => r.jobId);

/** The people who applied to a job, for the worker (AIV-P1-027), in id order as above. */
export const candidatesForJob = async (tx: Tx, workspaceId: string, jobId: string) =>
  (
    await tx
      .select({ personId: application.personId })
      .from(application)
      .where(and(eq(application.workspaceId, workspaceId), eq(application.jobId, jobId), hasSource))
      .orderBy(application.personId)
  ).map((r) => r.personId);

/** What a duplicate merge moved for one person (AIV-P1-018), stored with the merge and read back for its undo. */
const movedSchema = z.strictObject({
  /** Applications now the survivor's. */
  applicationIds: z.array(z.uuid()),
  /** Sources moved into the survivor's application for a job both applied to, each with the application it left. */
  sources: z.array(z.strictObject({ id: z.uuid(), from: z.uuid() })),
});

/**
 * A person's applications for a duplicate merge (AIV-P1-018), in the merge's transaction: listed for its preview, moved
 * to the survivor, and moved back by its undo. When both applied to the same job (one application per person and job),
 * the merged person's sources join the survivor's application and their emptied application is kept for the undo.
 */
export const applicationRecords = {
  async list(tx: Tx, workspaceId: string, personId: string) {
    const rows = await tx
      .select({
        applicationId: application.id,
        jobId: application.jobId,
        stage: application.stage,
        source: applicationSource.source,
      })
      .from(application)
      .innerJoin(
        applicationSource,
        and(
          eq(applicationSource.workspaceId, application.workspaceId),
          eq(applicationSource.applicationId, application.id),
        ),
      )
      .where(and(eq(application.workspaceId, workspaceId), eq(application.personId, personId)))
      .orderBy(asc(application.receivedAt), asc(application.id), asc(applicationSource.receivedAt));
    const byApplication = new Map<string, { jobId: string; stage: Stage; sources: Source[] }>();
    for (const r of rows) {
      const entry = byApplication.get(r.applicationId) ?? { jobId: r.jobId, stage: r.stage, sources: [] };
      if (!entry.sources.includes(r.source)) entry.sources.push(r.source);
      byApplication.set(r.applicationId, entry);
    }
    return [...byApplication.values()];
  },

  async move(tx: Tx, workspaceId: string, fromId: string, toId: string) {
    const ofPerson = (personId: string) =>
      tx
        .select({ id: application.id, jobId: application.jobId })
        .from(application)
        .where(and(eq(application.workspaceId, workspaceId), eq(application.personId, personId)))
        .orderBy(asc(application.id))
        .for('update');
    const survivors = new Map((await ofPerson(toId)).map((a) => [a.jobId, a.id]));
    const moved: z.infer<typeof movedSchema> = { applicationIds: [], sources: [] };
    for (const app of await ofPerson(fromId)) {
      const into = survivors.get(app.jobId);
      if (!into) {
        await tx
          .update(application)
          .set({ personId: toId })
          .where(and(eq(application.workspaceId, workspaceId), eq(application.id, app.id)));
        moved.applicationIds.push(app.id);
        continue;
      }
      const sources = await tx
        .update(applicationSource)
        .set({ applicationId: into })
        .where(and(eq(applicationSource.workspaceId, workspaceId), eq(applicationSource.applicationId, app.id)))
        .returning({ id: applicationSource.id });
      moved.sources.push(...sources.map((s) => ({ id: s.id, from: app.id })));
    }
    return { moved, count: moved.applicationIds.length + new Set(moved.sources.map((s) => s.from)).size };
  },

  // shortcut: a whole application moves back with every source it holds, so one that arrived on it after the merge by
  // the survivor's own identifiers goes to the merged person too (pinned in duplicates.test.ts); record which person
  // each arrival matched and split them here if recruiters see it happen.
  async restore(tx: Tx, workspaceId: string, fromId: string, toId: string, stored: unknown) {
    const moved = movedSchema.parse(stored);
    if (moved.applicationIds.length > 0)
      await tx
        .update(application)
        .set({ personId: fromId })
        .where(
          and(
            eq(application.workspaceId, workspaceId),
            eq(application.personId, toId),
            inArray(application.id, moved.applicationIds),
          ),
        );
    for (const { id, from } of moved.sources)
      await tx
        .update(applicationSource)
        .set({ applicationId: from })
        .where(and(eq(applicationSource.workspaceId, workspaceId), eq(applicationSource.id, id)));
  },
};
