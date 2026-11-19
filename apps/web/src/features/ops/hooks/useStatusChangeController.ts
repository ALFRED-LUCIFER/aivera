import { STATUS_CHANGES, type StatusChange } from '@aivera/workspaces';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { canConfirmChange, type StatusChangeView } from '../domain/workspaces.ts';
import { changeWorkspaceStatus } from '../services/changeWorkspaceStatus.ts';

/**
 * One status change on one workspace (suspend, reactivate, approve or reject; AIV-P2-037, AIV-P2-039): the preview card,
 * its reason, and the confirmed change. Nothing is sent until Confirm; a refusal rejects, so the card says nothing
 * changed and stays open.
 */
export function useStatusChangeController(
  workspace: { id: string; name: string },
  change: StatusChange,
): StatusChangeView {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<StatusChangeView['done']>(null);
  return {
    name: workspace.name,
    change,
    open,
    onOpenChange: (next) => {
      setOpen(next);
      if (next) setReason('');
    },
    reason,
    onReasonChange: setReason,
    needsReason: STATUS_CHANGES[change].reason,
    canConfirm: canConfirmChange(change, reason),
    onConfirm: async () => {
      await changeWorkspaceStatus({ workspaceId: workspace.id, change, reason });
      setOpen(false);
      setDone(change);
      router.refresh();
    },
    done,
  };
}
