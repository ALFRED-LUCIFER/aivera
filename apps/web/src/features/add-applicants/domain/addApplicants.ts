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

/**
 * The confirmation shown above the add button (AIV-P1-104), as a message key under `import.rightToProcess` with the job
 * title as a parameter. The batch stores this key and its version, so a changed wording is a new key (`.v2`), never an
 * edit of this one. The key is the app's, never the browser's.
 */
export const RIGHT_TO_PROCESS_KEY = 'import.rightToProcess.v1';

/** The server action's input, validated again on the server (AGENTS.md 3.7). Never the workspace: that is the session's. */
export const addApplicantsSchema = z.strictObject({
  jobId: z.uuid(),
  /** The recruiter's tick: responsible for the right to process these CVs for this job. */
  rightToProcessConfirmed: z.literal(true),
  source: z.enum(SOURCE_OPTIONS),
  // One upload per CV; the same file twice would only add an empty second source. Up to 200 per save (AIV-P1-101, the
  // Import artboard's batch size); the files module limits each file, not a batch.
  // shortcut: every CV is filed in turn in one transaction (about ten queries each); queue the batch if 200 gets slow.
  fileIds: z
    .array(z.uuid())
    .min(1)
    .max(200)
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
  | { ok: false; error: 'notAccepted' | 'jobNotFound' | 'confirmationRequired' | 'failed' };
