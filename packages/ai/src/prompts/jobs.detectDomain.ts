import { z } from 'zod';
import { cited, type Source } from '../citations.ts';

// "Detect the job's industry" (AIV-P1-063, ADR-006 point 2): the prompt and schema, versioned here so every change runs
// the eval set (evals/jobs.detectDomain/). The jobs module calls it with its domain catalogue; the eval runner the same.

/** Bump with any change to the system prompt, the prompt or the schema; it goes on telemetry and the eval results. */
export const DETECT_DOMAIN_VERSION = 'jobs.detectDomain@1';

export const DETECT_DOMAIN_SYSTEM = [
  "You read a job description and say which industry the hiring company is in, so Aivera can suggest that industry's",
  'skills. Choose one domain from the list in the schema only when the description clearly shows the company works in',
  'it, and cite the sentence that shows it. When no industry is clear, answer domain "none" with no citation.',
  'Regions: list a region from the schema only for where the job or the company is based or operates, each citing the',
  'location or the description sentence that says so. Never infer a region, or anything else, from a line about the',
  'people to hire: nationality, residency, where someone is from, an employer they worked at, age or gender.',
].join(' ');

type Keys = readonly [string, ...string[]];

/**
 * The schema for one catalogue: the jobs module's `DOMAIN_KEYS` and `REGIONS`. A key outside them fails the schema, so
 * it is rejected and asked for once more, never patched. Azure strict mode needs every property present, and an object
 * at the root: a union inside it, never `.optional()` (client.ts generateStructured).
 */
export const detectDomainSchema = <const D extends Keys, const R extends Keys>(catalogue: { domains: D; regions: R }) =>
  z.object({
    industry: z.union([z.object({ domain: z.enum(['none']) }), cited(z.object({ domain: z.enum(catalogue.domains) }))]),
    regions: z
      .array(cited(z.object({ region: z.enum(catalogue.regions) })))
      // A region named twice is rejected, never deduplicated (AGENTS.md 3.7).
      .refine((regions) => new Set(regions.map((r) => r.region)).size === regions.length),
  });

/**
 * The whole request but its workspace, so the jobs module and the eval runner send the same thing. Only the job type
 * and title are in the prompt; the description and the location are the sources: no candidate and nothing else from
 * the workspace.
 */
export const detectDomainRequest = <const D extends Keys, const R extends Keys>(
  input: { jobType: string; title: string },
  catalogue: { domains: D; regions: R },
  sources: readonly Source[],
) => ({
  task: 'jobs.detectDomain' as const,
  promptVersion: DETECT_DOMAIN_VERSION,
  system: DETECT_DOMAIN_SYSTEM,
  prompt: `Job type: ${input.jobType}\nTitle: ${input.title}`,
  schema: detectDomainSchema(catalogue),
  sources,
});
