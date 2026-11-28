import { offeredJobTypes, type CatalogueContent } from '@credalent/jobs';
import { z } from 'zod';
import type { SaveFailure } from '@/features/shell/domain/saveFailure.ts';

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

export const TEXT_MAX = 200;
export const DESCRIPTION_MAX = 20_000;

/** The form's schema: the job type must be one the published catalogue offers (ADR-013 point 7). */
const newJobForm = (catalogue: CatalogueContent) =>
  z.object({
    jobType: z.string().refine((key) => offeredJobTypes(catalogue).some((t) => t.key === key), { error: 'jobType' }),
    title: z.string().trim().min(1, { error: 'title' }).max(TEXT_MAX),
    // Any description is accepted, however thin: drafting works from the job type's starters too.
    description: z.string().trim().max(DESCRIPTION_MAX),
    team: optional(TEXT_MAX),
    clientId: optionalId,
    location: optional(TEXT_MAX),
    hiringOwnerUserId: optionalId,
  });
export type NewJobInput = z.infer<ReturnType<typeof newJobForm>>;

/** The job types Add a job offers, in catalogue order, with their label, "Evidence that counts" and starters. */
export const jobTypeOptions = (catalogue: CatalogueContent) =>
  offeredJobTypes(catalogue).map((t) => ({
    value: t.key,
    label: t.label.en,
    evidence: t.evidence.en,
    starters: t.starterCompetencies,
  }));
export type JobTypeOption = ReturnType<typeof jobTypeOptions>[number];

/** The fields as posted, as strings, so a refused submit shows them again. */
export const formValues = (form: FormData): NewJobValues =>
  Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? '')])) as NewJobValues;

/** The required fields the recruiter must fix; anything else refused (forged ids, over-long text) is `failed`. */
export type NewJobState = {
  errors: { title?: true; jobType?: true };
  /** `saveFailed`, `saveForbidden`: the save threw in the browser; the form keeps what was typed (AIV-P2-064). */
  error: 'failed' | SaveFailure | null;
  /** The job and rubric version 1 were saved (AIV-P1-010): the page shows what happens next. */
  saved: boolean;
  /** The job, whose rubric page the saved state links to (AIV-P1-165); set once saved. */
  jobId?: string;
  /** Version 1, which "Send rubric for approval" sends (AIV-P1-014); set once saved. */
  rubricVersionId?: string;
  values: NewJobValues;
};
export const initialNewJobState = (jobType: string): NewJobState => ({
  errors: {},
  error: null,
  saved: false,
  values: { ...Object.fromEntries(FIELDS.map((f) => [f, ''])), jobType } as NewJobValues,
});

/** The validated form, against the published catalogue, or the state to show again (AGENTS.md 3.7). */
export function parseNewJobForm(
  form: FormData,
  catalogue: CatalogueContent,
): { input: NewJobInput } | { state: NewJobState } {
  const values = formValues(form);
  const parsed = newJobForm(catalogue).safeParse(values);
  if (parsed.success) return { input: parsed.data };
  const errors: NewJobState['errors'] = {};
  for (const issue of parsed.error.issues)
    if (issue.message === 'title' || issue.message === 'jobType') errors[issue.message] = true;
  return { state: { errors, error: Object.keys(errors).length ? null : 'failed', saved: false, values } };
}

/** "What this person must be able to do:" then the chosen job type's four starter competencies as a list. */
export const descriptionPlaceholder = (intro: string, starters: readonly string[]): string =>
  [intro, ...starters.map((c) => `- ${c}`)].join('\n');

/** The workspace's hiring focus preselects the job type when the catalogue offers it. */
export const defaultJobType = (hiringFocus: string, catalogue: CatalogueContent): string =>
  offeredJobTypes(catalogue).some((t) => t.key === hiringFocus) ? hiringFocus : '';
