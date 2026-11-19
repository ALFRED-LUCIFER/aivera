import type { WorkspaceStatus } from '@aivera/workspaces';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { nextChange, reasonReady, type StatusChangeView } from '../domain/workspaces.ts';
import { changeWorkspaceStatus } from '../services/changeWorkspaceStatus.ts';

/**
 * Suspend or reactivate one workspace (AIV-P2-037): the preview card, its reason, and the confirmed change. Nothing is
 * sent until Confirm; a refusal rejects, so the card says nothing changed and stays open.
 */
export function useStatusChangeController(workspace: {
  id: string;
  name: string;
  status: WorkspaceStatus;
}): StatusChangeView {
  const router = useRouter();
  const change = nextChange(workspace.status);
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
    canConfirm: reasonReady(reason),
    onConfirm: async () => {
      await changeWorkspaceStatus({ workspaceId: workspace.id, change, reason });
      setOpen(false);
      setDone(change);
      router.refresh();
    },
    done,
  };
}
