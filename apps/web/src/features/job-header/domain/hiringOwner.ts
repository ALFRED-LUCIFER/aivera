import { z } from 'zod';

export const REASON_MAX = 500;

/** The change an admin confirms in the job header (AIV-P1-097); the server action validates it with the same schema. */
export const changeOwnerSchema = z.object({
  jobId: z.uuid(),
  ownerId: z.uuid(),
  reason: z.string().trim().min(1).max(REASON_MAX),
});
export type ChangeOwnerInput = z.infer<typeof changeOwnerSchema>;

/** An active hiring-owner member the admin may pick. */
export type OwnerOption = { userId: string; name: string };

/** What the admin sees in the header: the current owner's id and the members to pick from. Null for everyone else. */
export type OwnerChange = { currentUserId: string | null; options: OwnerOption[] };

/** What the dialog shows and does; the controller hook builds it and the component only renders it. */
export type ChangeOwnerView = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerId: string;
  onOwnerChange: (ownerId: string) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  preview: { gains: string | null; loses: string | null };
  canConfirm: boolean;
  done: boolean;
  /** Rejects when the change was not saved, so the card shows "Nothing was changed". */
  onConfirm: () => Promise<void>;
};

export type ChangeOwnerResult = { ok: true } | { ok: false; error: 'invalid' | 'owner' | 'failed' };

/** The access that will be added and revoked, by name, before anything is written. */
export function ownerChangePreview(change: OwnerChange, selectedId: string) {
  const name = (id: string | null) => change.options.find((o) => o.userId === id)?.name ?? null;
  const gains = selectedId && selectedId !== change.currentUserId ? name(selectedId) : null;
  return { gains, loses: gains && change.currentUserId ? name(change.currentUserId) : null };
}
