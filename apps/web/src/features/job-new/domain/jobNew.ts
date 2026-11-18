import { JOB_TYPE_CATALOGUE, JOB_TYPES, type JobType } from '@aivera/jobs';
import { z } from 'zod';

// Add a job, step 1 (AIV-P1-007, RoleNew "1. The job"). Pure: no React, no I/O (ADR-003).

const FIELDS = ['jobType', 'title', 'description', 'team', 'clientId', 'location', 'hiringOwnerUserId'] as const;
type Field = (typeof FIELDS)[number];
export type NewJobValues = Record<Field, string>;

// An empty optional field is null, as the job stores it; ids are opaque uuids the page offered, checked again on the server.
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);
const optionalId = z.union([z.literal('').transform(() => null), z.uuid()]);

export const newJobForm = z.object({
  jobType: z.enum(JOB_TYPES, { error: 'jobType' }),
  title: z.string().trim().min(1, { error: 'title' }).max(200),
  // Any description is accepted, however thin: drafting works from the job type's starters too.
  description: z.string().trim().max(20_000),
  team: optional(200),
  clientId: optionalId,
  location: optional(200),
  hiringOwnerUserId: optionalId,
});
export type NewJobForm = z.infer<typeof newJobForm>;

/** The fields as posted, as strings, so a refused submit shows them again. */
export const formValues = (form: FormData): NewJobValues =>
  Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? '')])) as NewJobValues;

/** The required fields the recruiter must fix; anything else refused (forged ids, over-long text) is `failed`. */
export type NewJobState = {
  errors: { title?: true; jobType?: true };
  error: 'failed' | null;
  values: NewJobValues;
};
export const initialNewJobState = (jobType: string): NewJobState => ({
  errors: {},
  error: null,
  values: { ...Object.fromEntries(FIELDS.map((f) => [f, ''])), jobType } as NewJobValues,
});

/** The validated form, or the state to show again (AGENTS.md 3.7). */
export function parseNewJobForm(form: FormData): { input: NewJobForm } | { state: NewJobState } {
  const values = formValues(form);
  const parsed = newJobForm.safeParse(values);
  if (parsed.success) return { input: parsed.data };
  const errors: NewJobState['errors'] = {};
  for (const issue of parsed.error.issues)
    if (issue.message === 'title' || issue.message === 'jobType') errors[issue.message] = true;
  return { state: { errors, error: Object.keys(errors).length ? null : 'failed', values } };
}

/** "What this person must be able to do:" then the job type's four starter competencies as a list. */
export const descriptionPlaceholder = (intro: string, jobType: string): string =>
  [intro, ...(JOB_TYPE_CATALOGUE.find((e) => e.key === jobType)?.starterCompetencies ?? []).map((c) => `- ${c}`)].join(
    '\n',
  );

/** The workspace's hiring focus preselects the job type when it is one of the ten. */
export const defaultJobType = (hiringFocus: string): JobType | '' =>
  (JOB_TYPES as readonly string[]).includes(hiringFocus) ? (hiringFocus as JobType) : '';
