import { z } from 'zod';

// Creating a workspace after sign-in (AIV-P1-001). Pure: no React, no I/O (ADR-003). Name, email and password come
// from the sign-in tenant (AIV-P0-009), so the form asks only for what the tenant does not know.

/** The ten job families (PRODUCT.md), then the two catch-alls. Labels are `signup.focus.<key>`. */
// shortcut: keys only; the job types catalogue with each family's starter evidence types and rubric is AIV-P1-004.
export const HIRING_FOCUS = [
  'software_engineering',
  'qa_test_automation',
  'ai_llm_engineering',
  'forward_deployed_engineering',
  'data_ml',
  'devops_sre',
  'product_management',
  'product_design',
  'sales',
  'technical_writing_support',
  'several',
  'other',
] as const;
export type HiringFocus = (typeof HIRING_FOCUS)[number];

const createWorkspaceForm = z.object({
  company: z.string().trim().max(200),
  hiringFocus: z.enum(HIRING_FOCUS),
});
export type CreateWorkspaceForm = z.infer<typeof createWorkspaceForm>;

/** The posted form, validated (AGENTS.md 3.7); null when it is not one we would send. */
export const parseCreateWorkspaceForm = (form: FormData): CreateWorkspaceForm | null =>
  createWorkspaceForm.safeParse({ company: form.get('company') ?? '', hiringFocus: form.get('hiringFocus') }).data ??
  null;

/** An empty company names the workspace after the person (a solo recruiter). */
export const workspaceName = (company: string, person: string) => company || person;

/** What the form shows after a refused or failed submit: the error, and what was typed so nothing is lost. */
export type CreateWorkspaceState = { error: 'failed' | null; values: { company: string; hiringFocus: string } };
export const initialCreateWorkspaceState: CreateWorkspaceState = {
  error: null,
  values: { company: '', hiringFocus: '' },
};
