import { offeredJobTypes, type CatalogueVersion } from '@credalent/jobs';
import { z } from 'zod';

// Creating a workspace after sign-in (AIV-P1-001). Pure: no React, no I/O (ADR-003). Name, email and password come
// from the sign-in tenant (AIV-P0-009), so the form asks only for what the tenant does not know.

/** The two catch-alls after the job types (labels `signup.focus.<key>`); the catalogue reserves both keys. */
export const CATCH_ALL_FOCUS = ['several', 'other'] as const;

/**
 * The hiring focus choices: the job types the published catalogue offers (their stored label), then the two catch-alls.
 * The key is what the workspace stores.
 */
export const hiringFocusKeys = (catalogue: CatalogueVersion): string[] => [
  ...offeredJobTypes(catalogue).map((t) => t.key),
  ...CATCH_ALL_FOCUS,
];

export type CreateWorkspaceForm = { company: string; hiringFocus: string };

/** The posted form, validated against the published catalogue (AGENTS.md 3.7); null when it is not one we would send. */
export const parseCreateWorkspaceForm = (form: FormData, catalogue: CatalogueVersion): CreateWorkspaceForm | null =>
  z
    .object({
      company: z.string().trim().max(200),
      hiringFocus: z.string().refine((key) => hiringFocusKeys(catalogue).includes(key)),
    })
    .safeParse({ company: form.get('company') ?? '', hiringFocus: form.get('hiringFocus') }).data ?? null;

/** An empty company names the workspace after the person (a solo recruiter). */
export const workspaceName = (company: string, person: string) => company || person;

/** What the form shows after a refused or failed submit: the error, and what was typed so nothing is lost. */
export type CreateWorkspaceState = { error: 'failed' | null; values: { company: string; hiringFocus: string } };
export const initialCreateWorkspaceState: CreateWorkspaceState = {
  error: null,
  values: { company: '', hiringFocus: '' },
};
