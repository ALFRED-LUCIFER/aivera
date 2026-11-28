import { useState, useTransition } from 'react';
import { correctNameSchema, type NameView } from '../domain/name.ts';
import * as actions from '../services/correctName.ts';

/**
 * "Correct name" on the profile (AIV-P1-165 §8): the name as read, a required reason, and Save, the only thing that
 * writes. A refused or failed save keeps the dialog open with what was typed. The action's revalidation brings the new
 * name to the page.
 */
export function useNameController(
  target: { candidateId: string; jobId: string },
  current: string,
  services: Pick<typeof actions, 'correctName'> = actions,
): NameView {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(current);
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const input = { ...target, name, reason };
  return {
    open,
    onOpenChange(next) {
      if (pending) return;
      setOpen(next);
      if (!next) return;
      setName(current);
      setReason('');
      setFailed(false);
      setDone(false);
    },
    name,
    onNameChange: setName,
    reason,
    onReasonChange: setReason,
    // The same name again is nothing to record.
    valid: correctNameSchema.safeParse(input).success && name.trim() !== current,
    pending,
    failed,
    done,
    onSave: () =>
      start(async () => {
        // A throw would reach the error boundary and take the typed reason with it.
        const result = await services.correctName(input).catch(() => ({ ok: false }) as const);
        setFailed(!result.ok);
        setDone(result.ok);
        if (result.ok) setOpen(false);
      }),
  };
}
