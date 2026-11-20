import type { Source } from '@credalent/intake';
import { z } from 'zod';

// Adding applicants by hand (AIV-P1-019): one or more clean CVs and the channel they came through.

/** The sources in the order the dialog offers them, each with its label key under `addApplicants.sources`. */
export const SOURCE_OPTIONS = [
  'linkedin',
  'referral',
  'email',
  'whatsapp',
  'careers_page',
] as const satisfies readonly Source[];
export type UploadSource = (typeof SOURCE_OPTIONS)[number];

/** The server action's input, validated again on the server (AGENTS.md 3.7). Never the workspace: that is the session's. */
export const addApplicantsSchema = z.strictObject({
  jobId: z.uuid(),
  source: z.enum(SOURCE_OPTIONS),
  // One upload per CV; the same file twice would only add an empty second source.
  fileIds: z
    .array(z.uuid())
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type AddApplicantsInput = z.infer<typeof addApplicantsSchema>;

/**
 * Per CV, whether it opened a new application or added a source to one this person already has for the job. `failed`
 * is the files message for a storage or server failure; `notAccepted` is the files module's own message for a CV that
 * is not clean.
 */
export type AddApplicantsResult =
  | { ok: true; applications: { applicationId: string; created: boolean }[] }
  | { ok: false; error: 'notAccepted' | 'jobNotFound' | 'failed' };
