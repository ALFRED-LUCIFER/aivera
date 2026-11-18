import type { Tx } from '@aivera/db/client';
import { desc, eq } from 'drizzle-orm';
import type { PublicJob, PublicJobLookup } from '../domain/public-job.ts';
import { publicJob } from './schema.ts';

// Only the columns aivera_public is granted (grants.sql): selecting workspace_id or job_id would be refused.
const columns = {
  slug: publicJob.slug,
  title: publicJob.title,
  jobType: publicJob.jobType,
  descriptor: publicJob.descriptor,
  location: publicJob.location,
  payMinMinor: publicJob.payMinMinor,
  payMaxMinor: publicJob.payMaxMinor,
  payCurrency: publicJob.payCurrency,
  competencies: publicJob.competencies,
  postedAt: publicJob.postedAt,
};

type Row = { [K in keyof typeof columns]: (typeof publicJob.$inferSelect)[K] };

const toPublicJob = ({ payMinMinor, payMaxMinor, payCurrency, ...row }: Row): PublicJob => ({
  ...row,
  payBand:
    payMinMinor !== null && payMaxMinor !== null && payCurrency !== null
      ? { minMinor: payMinMinor, maxMinor: payMaxMinor, currency: payCurrency }
      : null,
});

/** Every open job, newest first. `tx` must be running as aivera_public (composition.ts). */
export const listOpen = async (tx: Tx): Promise<PublicJob[]> =>
  (
    await tx
      .select(columns)
      .from(publicJob)
      .where(eq(publicJob.open, true))
      .orderBy(desc(publicJob.postedAt), publicJob.slug)
  ).map(toPublicJob);

/** The job at this slug, open or no longer open; null when no job ever had it. `tx` runs as aivera_public. */
export async function findBySlug(tx: Tx, slug: string): Promise<PublicJobLookup> {
  const [row] = await tx
    .select({ ...columns, open: publicJob.open })
    .from(publicJob)
    .where(eq(publicJob.slug, slug));
  if (!row) return null;
  const { open, ...listing } = row;
  return open ? { open: true, job: toPublicJob(listing) } : { open: false };
}
