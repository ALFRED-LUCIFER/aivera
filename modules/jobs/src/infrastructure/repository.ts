import type { Tx } from '@aivera/db/client';
import { uuidv7 } from '@aivera/db/uuidv7';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
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
        .set({ successStatement: version.successStatement, changeNote: version.changeNote, status: version.status })
        .where(where);
      await tx
        .delete(competency)
        .where(and(eq(competency.workspaceId, version.workspaceId), eq(competency.rubricVersionId, version.id)));
      await insertCompetencies(version.workspaceId, version.id, list);
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
    async closePublicJob(workspaceId, jobId) {
      await tx
        .update(publicJob)
        .set({ open: false })
        .where(and(eq(publicJob.workspaceId, workspaceId), eq(publicJob.jobId, jobId)));
    },
    async setStatus(workspaceId, versionId, status, approval) {
      await tx
        .update(rubricVersion)
        .set({ status, ...(approval && { approvedBy: approval.by, approvedAt: approval.at }) })
        .where(and(eq(rubricVersion.workspaceId, workspaceId), eq(rubricVersion.id, versionId)));
    },
  };
}
