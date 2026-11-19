import { useActionState, useState } from 'react';
import { initialManageState, type MemberDialog } from '../domain/members.ts';
import { manageMember } from '../services/memberActions.ts';

/**
 * The members list's changes (role, jobs, remove, revoke): one posted action and its last result, and the one dialog
 * open (edit jobs or remove). A dialog closes once its own change succeeds; a refused change keeps it open with the error.
 */
export function useMembersController() {
  const [state, action, pending] = useActionState(manageMember, initialManageState);
  const [dialog, setDialog] = useState<(MemberDialog & { at: number }) | null>(null);
  const open = dialog?.at === state.done ? dialog : null;
  return {
    state,
    action,
    pending,
    dialog: open && { kind: open.kind, id: open.id },
    onOpenDialog: (next: MemberDialog) => setDialog({ ...next, at: state.done }),
    onCloseDialog: () => setDialog(null),
  };
}
