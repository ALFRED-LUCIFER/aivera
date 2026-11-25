import { CHOICE_REASON_MAX } from '@credalent/intake';
import { z } from 'zod';
import type { CandidateRow } from './ranking.ts';

// AIV-P1-114: choosing people for interview from the ranking, after a preview. Nothing changes until a person confirms;
// nobody is contacted, and nobody not chosen changes (AGENTS.md 1.5).

export { CHOICE_REASON_MAX };

/** A recruiter's confirmed choice; the server action validates it with the same schema. */
export const chooseSchema = z.object({
  jobId: z.uuid(),
  applicationIds: z.array(z.uuid()).min(1).max(50),
  reason: z.string().trim().min(1).max(CHOICE_REASON_MAX),
});

export type ChooseResult =
  { ok: true; chosen: number } | { ok: false; error: 'invalid' | 'notOnJob' | 'refused' | 'failed' };

/** The selected rows in rank order; someone at stage `interview` is already chosen and gets no second interview. */
export const choosePreview = (rows: readonly CandidateRow[], ids: readonly string[]) => {
  const people = rows.filter((row) => ids.includes(row.id));
  return { people, toChoose: people.filter((row) => row.stage !== 'interview').length };
};

/** What the choose preview shows and does; the controller hook builds it and the components only render it. */
export type ChooseView = {
  /** Null while no preview is open. */
  preview: ReturnType<typeof choosePreview> | null;
  onPreview: (ids: readonly string[]) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  reasonValid: boolean;
  /** Why the last confirm was refused, for the card's message. */
  error: 'notOnJob' | 'failed' | null;
  /** How many were chosen by the last confirm, for the success message. */
  done: number | null;
  /** Rejects when nothing was saved, so the card shows "Nothing was changed". */
  onConfirm: () => Promise<void>;
  onCancel: () => void;
};
