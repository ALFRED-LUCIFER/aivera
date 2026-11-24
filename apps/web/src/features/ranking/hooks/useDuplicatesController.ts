import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  mergeSchema,
  undoMergeSchema,
  type DuplicateDialog,
  type DuplicatesView,
  type RowDuplicates,
} from '../domain/duplicates.ts';
import * as actions from '../services/mergeDuplicates.ts';

/**
 * The ranking rows' duplicate actions (AIV-P1-018): one merge or undo preview open at a time, its reason, and Confirm,
 * the only thing that writes. A failed save keeps the dialog and reason so the person can try again.
 */
export function useDuplicatesController(
  services: Pick<typeof actions, 'mergeDuplicate' | 'undoMerge'> = actions,
): DuplicatesView {
  const router = useRouter();
  const [dialog, setDialog] = useState<DuplicateDialog>(null);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<'merged' | 'undone' | null>(null);

  const input = (dup: RowDuplicates, kind: 'merge' | 'undo') =>
    kind === 'merge'
      ? { survivorId: dup.possible?.personId, mergedId: dup.personId, reason }
      : { mergeId: dup.undo?.mergeId, reason };

  return {
    isOpen: (rowId: string, kind: 'merge' | 'undo') => dialog?.rowId === rowId && dialog.kind === kind,
    onOpenChange: (rowId: string, kind: 'merge' | 'undo', open: boolean) => {
      setDialog(open ? { rowId, kind } : null);
      if (open) {
        setReason('');
        setDone(null);
      }
    },
    reason,
    onReasonChange: setReason,
    canConfirm: (dup: RowDuplicates, kind: 'merge' | 'undo') =>
      (kind === 'merge' ? mergeSchema : undoMergeSchema).safeParse(input(dup, kind)).success,
    done,
    async onConfirm(dup: RowDuplicates, kind: 'merge' | 'undo') {
      const result = await (kind === 'merge' ? services.mergeDuplicate : services.undoMerge)(input(dup, kind));
      // Rejecting shows the card's "Nothing was changed" message and keeps the dialog open.
      if (!result.ok) throw new Error(result.error);
      setDialog(null);
      setReason('');
      setDone(kind === 'merge' ? 'merged' : 'undone');
      router.refresh();
    },
  };
}
