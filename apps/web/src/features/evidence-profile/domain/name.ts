import { MERGE_REASON_MAX, NAME_MAX } from '@credalent/candidates';
import { z } from 'zod';

// AIV-P1-165 §8: a recruiter corrects the name read from a CV, with a reason. Pure; the candidates module holds the
// rule and audits it.

export { NAME_MAX };
export const NAME_REASON_MAX = MERGE_REASON_MAX;

/** A confirmed correction, by opaque ids; the server action validates it with the same schema (AGENTS.md 3.7). */
export const correctNameSchema = z.strictObject({
  candidateId: z.uuid(),
  jobId: z.uuid(),
  name: z.string().trim().min(1).max(NAME_MAX),
  reason: z.string().trim().min(1).max(NAME_REASON_MAX),
});

export type CorrectNameResult = { ok: true } | { ok: false; error: 'invalid' | 'failed' };

/** The "Correct name" dialog; the controller hook builds it and the component only renders it. */
export type NameView = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  /** Both fields hold something to save. */
  valid: boolean;
  pending: boolean;
  /** The last save was refused or failed: nothing was changed. */
  failed: boolean;
  /** The last save went through, for the success message. */
  done: boolean;
  onSave: () => void;
};
