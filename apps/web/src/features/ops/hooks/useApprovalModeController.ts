import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { reasonReady, type ApprovalModeView } from '../domain/workspaces.ts';
import { setApprovalMode } from '../services/setApprovalMode.ts';

/** Turning "New workspaces need approval" off or on (AIV-P2-039): nothing is sent until Confirm, with a reason. */
export function useApprovalModeController(required: boolean): ApprovalModeView {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<boolean | null>(null);
  return {
    required,
    open,
    onOpenChange: (next) => {
      setOpen(next);
      if (next) setReason('');
    },
    reason,
    onReasonChange: setReason,
    canConfirm: reasonReady(reason),
    onConfirm: async () => {
      await setApprovalMode({ required: !required, reason });
      setOpen(false);
      setDone(!required);
      router.refresh();
    },
    done,
  };
}
