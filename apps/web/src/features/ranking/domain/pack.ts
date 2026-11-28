import { NAME_MAX, NOTE_MAX } from '@credalent/decisions';
import { z } from 'zod';
import type { CandidateRow, PackChoice } from './ranking.ts';

// AIV-P2-010: adding selected candidates to a decision pack from the ranking, after a preview. Nothing changes until a
// person confirms; nobody is contacted, and nobody not added changes (AGENTS.md 1.5).

export { NAME_MAX, NOTE_MAX };

/** `new`, or an existing pack's id. */
export const NEW_PACK = 'new';

/** A confirmed addition: to an existing pack of the job, or a new one with a name. The server action re-validates it. */
export const addToPackSchema = z.object({
  jobId: z.uuid(),
  applicationIds: z.array(z.uuid()).min(1).max(50),
  pack: z.union([z.object({ packId: z.uuid() }), z.object({ name: z.string().trim().min(1).max(NAME_MAX) })]),
  /** Audited with each addition (AIV-P1-165: who, when and why). */
  reason: z.string().trim().min(1).max(NOTE_MAX),
});

export type AddToPackResult =
  { ok: true; packId: string; added: number } | { ok: false; error: 'invalid' | 'notOnJob' | 'refused' | 'failed' };

/**
 * The selected rows in rank order, each marked: to add, already in the chosen pack, or not yet scored (a pack holds
 * each member's assessment, so an unscored candidate cannot join yet).
 */
export function packPreview(rows: readonly CandidateRow[], ids: readonly string[], pack: PackChoice | undefined) {
  const people = rows
    .filter((row) => ids.includes(row.id))
    .map((row) => ({
      row,
      status: !row.score
        ? ('notScored' as const)
        : pack?.candidateIds.includes(row.personId)
          ? ('inPack' as const)
          : ('add' as const),
    }));
  return { people, toAdd: people.filter((p) => p.status === 'add').map((p) => p.row.id) };
}

/** What the add-to-pack preview shows and does; the controller hook builds it and the components only render it. */
export type PackView = {
  packs: PackChoice[];
  /** Null while no preview is open. */
  preview: ReturnType<typeof packPreview> | null;
  /** Counts the opens: the card remounts on each, so it comes back into view and takes focus even while open. */
  opened: number;
  onPreview: (ids: readonly string[]) => void;
  /** `NEW_PACK` or an existing pack's id. */
  target: string;
  onTargetChange: (target: string) => void;
  name: string;
  onNameChange: (name: string) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  reasonValid: boolean;
  canConfirm: boolean;
  error: 'notOnJob' | 'failed' | null;
  /** The last confirmed addition, for the success message and its link to the pack. */
  done: { packId: string; added: number; name: string } | null;
  /** Rejects when nothing was saved, so the card shows "Nothing was changed". */
  onConfirm: () => Promise<void>;
  onCancel: () => void;
};

/** The pack page's address (AIV-P2-010), from opaque ids. */
export const packHref = (jobId: string, packId: string) => `/app/jobs/${jobId}/packs/${packId}`;
