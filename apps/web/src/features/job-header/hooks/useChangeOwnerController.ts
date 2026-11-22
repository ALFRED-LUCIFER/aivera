import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  changeOwnerSchema,
  ownerChangePreview,
  type ChangeOwnerView,
  type OwnerChange,
} from '../domain/hiringOwner.ts';
import * as actions from '../services/changeHiringOwner.ts';

/**
 * The admin's "Change hiring owner" dialog (AIV-P1-097): the pick, the reason, the preview of who gains and loses
 * access, and Confirm, the only thing that writes. A failed save keeps the choice and reason so the admin can try again.
 */
export function useChangeOwnerController(jobId: string, change: OwnerChange, services = actions): ChangeOwnerView {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ownerId, setOwnerId] = useState('');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(false);

  return {
    open,
    onOpenChange: (next: boolean) => {
      setOpen(next);
      if (next) setDone(false);
    },
    ownerId,
    onOwnerChange: setOwnerId,
    reason,
    onReasonChange: setReason,
    preview: ownerChangePreview(change, ownerId),
    canConfirm: changeOwnerSchema.safeParse({ jobId, ownerId, reason }).success && ownerId !== change.currentUserId,
    done,
    async onConfirm() {
      const result = await services.changeHiringOwner({ jobId, ownerId, reason });
      // Rejecting shows the card's "nothing was changed" message and keeps the dialog open.
      if (!result.ok) throw new Error(result.error);
      setOpen(false);
      setOwnerId('');
      setReason('');
      setDone(true);
      router.refresh();
    },
  };
}
