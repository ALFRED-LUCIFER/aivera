// The candidate site's read model of a published job (AIV-P3-002): the allow-listed listing (AIV-P1-015) plus its
// public address and posted date. Nothing here may carry a weight, the client's name, a candidate, a score or an id.
import { z } from 'zod';
import { JOB_TYPES } from './job-types.ts';
import type { PublicListing } from './job.ts';

export type PublicJob = Omit<PublicListing, 'descriptor'> & {
  /** Always set: a job is published only with one. */
  descriptor: string;
  /** The public address, e.g. "senior-ai-engineer-3f9a1c0b2d4e"; never the internal id. */
  slug: string;
  postedAt: Date;
};

/** What a slug lookup finds: an open job, one that was taken down ("no longer open"), or nothing. */
export type PublicJobLookup = { open: true; job: PublicJob } | { open: false } | null;

/** A slug: lowercase letters, digits and hyphens. Anything else is not a job address. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_TITLE_MAX = 60;

/** "Senior Product Manager, Payments" + "3f9a1c0b2d4e" -> "senior-product-manager-payments-3f9a1c0b2d4e". */
export const slugFor = (title: string, suffix: string): string => {
  const words = title
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_TITLE_MAX)
    .replaceAll(/^-+|-+$/g, '');
  return words ? `${words}-${suffix}` : suffix;
};

/**
 * The public contract as JSON, the shape every public response is parsed through on its way out. `strict`, so a
 * field added to the read model by mistake (a weight, a client name) fails the response instead of leaking.
 */
export const publicJobJson = z.strictObject({
  slug: z.string().regex(SLUG),
  title: z.string(),
  jobType: z.enum(JOB_TYPES),
  descriptor: z.string(),
  location: z.string().nullable(),
  payBand: z.strictObject({ minMinor: z.int(), maxMinor: z.int(), currency: z.string().length(3) }).nullable(),
  competencies: z.array(
    z.strictObject({ name: z.string(), evidenceExpected: z.string(), levelNeeded: z.int().min(1).max(5) }),
  ),
  postedAt: z.iso.datetime(),
});
export type PublicJobJson = z.infer<typeof publicJobJson>;

export const toPublicJobJson = (job: PublicJob): PublicJobJson =>
  publicJobJson.parse({ ...job, postedAt: job.postedAt.toISOString() });
