import { MERGE_REASON_MAX, type LikelyReason } from '@credalent/candidates';
import type { Source } from '@credalent/intake';
import { z } from 'zod';

/** One side of a merge as the preview lists it: the person's applications by job title, and their evidence count. */
export type MergeSide = { name: string; applications: { job: string; sources: Source[] }[]; evidenceSources: number };

/**
 * A row's duplicates (AIV-P1-018), sent only to admins and recruiters: how many records were merged into this one,
 * the newest merge an admin may still undo, and an earlier record this one may duplicate, with what merging combines.
 */
export type RowDuplicates = {
  personId: string;
  mergedCount: number;
  /** Set for admins only, while the newest merge is inside the workspace's undo window. */
  undo: { mergeId: string; name: string } | null;
  possible: {
    personId: string;
    name: string;
    reason: LikelyReason;
    survivor: MergeSide;
    merged: MergeSide;
  } | null;
};

const reason = z.string().trim().min(1).max(MERGE_REASON_MAX);

/** A recruiter's confirmed merge; the server action validates it with the same schema. */
export const mergeSchema = z.object({ survivorId: z.uuid(), mergedId: z.uuid(), reason });
/** An admin's confirmed undo. */
export const undoMergeSchema = z.object({ mergeId: z.uuid(), reason });

export type MergeResult = { ok: true } | { ok: false; error: 'invalid' | 'refused' | 'failed' };

/** Which dialog is open: the merge of a row's possible duplicate, or the undo of its newest merge. */
export type DuplicateDialog = { rowId: string; kind: 'merge' | 'undo' } | null;

type Kind = 'merge' | 'undo';

/** What the rows' duplicate actions show and do; the controller hook builds it and the components only render it. */
export type DuplicatesView = {
  isOpen: (rowId: string, kind: Kind) => boolean;
  onOpenChange: (rowId: string, kind: Kind, open: boolean) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  canConfirm: (duplicates: RowDuplicates, kind: Kind) => boolean;
  /** The last confirmed change, for the success message. */
  done: 'merged' | 'undone' | null;
  /** Rejects when nothing was saved, so the card shows "Nothing was changed". */
  onConfirm: (duplicates: RowDuplicates, kind: Kind) => Promise<void>;
};
