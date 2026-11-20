import type { Tx } from '@aivera/db/client';
import { uuidv7 } from '@aivera/db/uuidv7';
import { and, asc, count, desc, eq, gte, or, sql } from 'drizzle-orm';
import type { JobStore } from '../application/jobs.ts';
import type { Competency, Job, RubricStatus } from '../domain/job.ts';
import { competency, job, jobInScope, publicJob, rubricVersion } from './schema.ts';

const toJob = ({ payMinMinor, payMaxMinor, payCurrency, ...row }: typeof job.$inferSelect): Job => ({
  ...row,
  payBand:
    payMinMinor !== null && payMaxMinor !== null && payCurrency !== null
      ? { minMinor: payMinMinor, maxMinor: payMaxMinor, currency: payCurrency }
      : null,
});

const competencyColumns = {
  name: competency.name,
  evidenceExpected: competency.evidenceExpected,
  weightPercent: competency.weightPercent,
  levelNeeded: competency.levelNeeded,
  type: competency.type,
  origin: competency.origin,
  packKey: competency.packKey,
  packVersion: competency.packVersion,
};

const jobWhere = (workspaceId: string) => and(eq(job.workspaceId, workspaceId), jobInScope(job.id, job.clientId));

/**
 * The jobs store over a workspace-scoped transaction. The `workspace_id` and job-scope filters here are the first
 * layer; row-level security on the transaction's settings is the second (ADR-005).
 */
export function jobStore(tx: Tx): JobStore {
  const insertCompetencies = async (workspaceId: string, versionId: string, list: Competency[]) => {
    await tx
      .insert(competency)
      .values(list.map((c, position) => ({ ...c, id: uuidv7(), workspaceId, rubricVersionId: versionId, position })));
  };

  return {
    async insertJob({ payBand, ...values }) {
      await tx.insert(job).values({
        ...values,
        payMinMinor: payBand?.minMinor ?? null,
        payMaxMinor: payBand?.maxMinor ?? null,
        payCurrency: payBand?.currency ?? null,
      });
    },
    async getJob(workspaceId, jobId, opts) {
      const query = tx
        .select()
        .from(job)
        .where(and(jobWhere(workspaceId), eq(job.id, jobId)));
      const [row] = opts?.lock ? await query.for('update') : await query;
      return row ? toJob(row) : null;
    },
    async listJobs(workspaceId) {
      const rows = await tx.select().from(job).where(jobWhere(workspaceId)).orderBy(asc(job.createdAt), asc(job.id));
      return rows.map(toJob);
    },
    // No jobInScope here: callers look states up only for jobs listJobs returned, and RLS scopes rubric_version too.
    rubricStates(workspaceId) {
      return tx
        .select({
          jobId: rubricVersion.jobId,
          approved: sql<boolean>`bool_or(${rubricVersion.status} = 'approved')`,
          latest: sql<RubricStatus>`(array_agg(${rubricVersion.status} order by ${rubricVersion.version} desc))[1]`,
        })
        .from(rubricVersion)
        .where(eq(rubricVersion.workspaceId, workspaceId))
        .groupBy(rubricVersion.jobId);
    },
    async latestVersion(workspaceId, jobId) {
      const [row] = await tx
        .select()
        .from(rubricVersion)
        .where(and(eq(rubricVersion.workspaceId, workspaceId), eq(rubricVersion.jobId, jobId)))
        .orderBy(desc(rubricVersion.version))
        .limit(1);
      return row ?? null;
    },
    async getVersion(workspaceId, versionId) {
      const [row] = await tx
        .select()
        .from(rubricVersion)
        .where(and(eq(rubricVersion.workspaceId, workspaceId), eq(rubricVersion.id, versionId)));
      return row ?? null;
    },
    listVersions(workspaceId, jobId) {
      return tx
        .select()
        .from(rubricVersion)
        .where(and(eq(rubricVersion.workspaceId, workspaceId), eq(rubricVersion.jobId, jobId)))
        .orderBy(desc(rubricVersion.version));
    },
    async approvedVersion(workspaceId, jobId) {
      const [row] = await tx
        .select()
        .from(rubricVersion)
        .where(
          and(
            eq(rubricVersion.workspaceId, workspaceId),
            eq(rubricVersion.jobId, jobId),
            eq(rubricVersion.status, 'approved'),
          ),
        );
      return row ?? null;
    },
    competencies(workspaceId, versionId) {
      return tx
        .select(competencyColumns)
        .from(competency)
        .where(and(eq(competency.workspaceId, workspaceId), eq(competency.rubricVersionId, versionId)))
        .orderBy(asc(competency.position));
    },
    async insertVersion(version, list) {
      await tx.insert(rubricVersion).values(version);
      await insertCompetencies(version.workspaceId, version.id, list);
    },
    async replaceDraft(version, list) {
      const where = and(eq(rubricVersion.workspaceId, version.workspaceId), eq(rubricVersion.id, version.id));
      await tx
        .update(rubricVersion)
        .set({
          successStatement: version.successStatement,
          changeNote: version.changeNote,
          status: version.status,
          revision: version.revision,
        })
        .where(where);
      await tx
        .delete(competency)
        .where(and(eq(competency.workspaceId, version.workspaceId), eq(competency.rubricVersionId, version.id)));
      await insertCompetencies(version.workspaceId, version.id, list);
    },
    rubricApprovals(workspaceId, approvedSince) {
      return tx
        .select({
          jobId: job.id,
          title: job.title,
          hiringOwnerUserId: job.hiringOwnerUserId,
          versionId: rubricVersion.id,
          version: rubricVersion.version,
          status: rubricVersion.status,
          approvedAt: rubricVersion.approvedAt,
        })
        .from(rubricVersion)
        .innerJoin(job, and(eq(job.workspaceId, rubricVersion.workspaceId), eq(job.id, rubricVersion.jobId)))
        .where(
          and(
            jobWhere(workspaceId),
            or(
              eq(rubricVersion.status, 'awaiting_approval'),
              and(eq(rubricVersion.status, 'approved'), gte(rubricVersion.approvedAt, approvedSince)),
            ),
          ),
        )
        .orderBy(asc(job.createdAt), asc(job.id), asc(rubricVersion.version));
    },
    async setHiringOwner(workspaceId, jobId, hiringOwnerUserId) {
      await tx
        .update(job)
        .set({ hiringOwnerUserId })
        .where(and(jobWhere(workspaceId), eq(job.id, jobId)));
    },
    async setStage(workspaceId, jobId, stage) {
      await tx
        .update(job)
        .set({ stage })
        .where(and(jobWhere(workspaceId), eq(job.id, jobId)));
    },
    async setPublication(workspaceId, jobId, publication) {
      await tx
        .update(job)
        .set(publication)
        .where(and(jobWhere(workspaceId), eq(job.id, jobId)));
    },
    async upsertPublicJob({ jobId, workspaceId, slug, listing, postedAt }) {
      const values = {
        title: listing.title,
        jobType: listing.jobType,
        descriptor: listing.descriptor,
        location: listing.location,
        payMinMinor: listing.payBand?.minMinor ?? null,
        payMaxMinor: listing.payBand?.maxMinor ?? null,
        payCurrency: listing.payBand?.currency ?? null,
        competencies: listing.competencies,
        postedAt,
        open: true,
      };
      await tx
        .insert(publicJob)
        .values({ jobId, workspaceId, slug, ...values })
        .onConflictDoUpdate({ target: publicJob.jobId, set: values });
    },
    async publicSlug(workspaceId, jobId) {
      const [row] = await tx
        .select({ slug: publicJob.slug })
        .from(publicJob)
        .where(and(eq(publicJob.workspaceId, workspaceId), eq(publicJob.jobId, jobId)));
      return row?.slug ?? null;
    },
    async closePublicJob(workspaceId, jobId) {
      await tx
        .update(publicJob)
        .set({ open: false })
        .where(and(eq(publicJob.workspaceId, workspaceId), eq(publicJob.jobId, jobId)));
    },
    async pausePublicJobs(workspaceId, paused) {
      await tx.update(publicJob).set({ paused }).where(eq(publicJob.workspaceId, workspaceId));
    },
    async setStatus(workspaceId, versionId, status, change) {
      await tx
        .update(rubricVersion)
        .set({ status, ...change })
        .where(and(eq(rubricVersion.workspaceId, workspaceId), eq(rubricVersion.id, versionId)));
    },
    // Approved and superseded versions too: the frozen-version triggers let a synthetic job's go (AIV-P1-067).
    async deleteSyntheticJobs(workspaceId) {
      const [real] = await tx
        .select({ id: job.id })
        .from(job)
        .where(and(eq(job.workspaceId, workspaceId), eq(job.synthetic, false)))
        .limit(1);
      if (real) return false;
      await tx.delete(publicJob).where(eq(publicJob.workspaceId, workspaceId));
      await tx.delete(competency).where(eq(competency.workspaceId, workspaceId));
      await tx.delete(rubricVersion).where(eq(rubricVersion.workspaceId, workspaceId));
      await tx.delete(job).where(eq(job.workspaceId, workspaceId));
      return true;
    },
  };
}

/**
 * How many jobs the workspace has, every stage included, for the operator console (ADR-012 point 6). Over the
 * workspace's scoped transaction with the job scope set to all for this transaction only: a count, never a job's fields.
 */
export async function countJobs(tx: Tx, workspaceId: string): Promise<number> {
  await tx.execute(sql`select set_config('app.job_scope', 'all', true)`);
  const [found] = await tx.select({ n: count() }).from(job).where(eq(job.workspaceId, workspaceId));
  return found?.n ?? 0;
}
