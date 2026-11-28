import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveFailure } from '@/features/shell/domain/saveFailure.ts';
import type { ReviewView, RubricDecisionView } from '../domain/rubric.ts';
import { decideRubric } from '../services/decideRubric.ts';
import { sendRubricForApproval } from '../services/sendRubricForApproval.ts';

/**
 * The approval panel (AIV-P1-014, ADR-014): approve the version, return a sent one with a note, or send a draft to the
 * hiring owner. "Approve rubric" opens a preview with a reason field (AIV-P1-165); nothing changes on the server until
 * its Confirm, "Return version N" or "Send to the hiring owner" is chosen.
 */
export function useRubricDecisionController(jobId: string, review: ReviewView | null): RubricDecisionView {
  const router = useRouter();
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState('');
  const [approving, setApproving] = useState(false);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<RubricDecisionView['status']>('idle');
  const [decided, setDecided] = useState<RubricDecisionView['decided']>(null);
  const [pending, startTransition] = useTransition();

  /** A return carries its note, an approval its reason; resolves once the outcome is shown in the panel. */
  const decide = (decision: { note: string } | { reason: string }) =>
    new Promise<void>((shown) =>
      startTransition(async () => {
        await apply(decision);
        // Success or not, the approve preview closes: the outcome is said in the panel, and the reason typed stays.
        setApproving(false);
        shown();
      }),
    );
  const apply = async (decision: { note: string } | { reason: string }) => {
    if (!review) return;
    const { versionId, revision } = review;
    let result;
    try {
      result = await decideRubric({ jobId, versionId, revision, ...decision });
    } catch (error) {
      // The note typed so far stays in the panel.
      return setStatus(saveFailure(error));
    }
    if ('error' in result) return setStatus(result.error);
    setDecided({ version: review.version, inForce: review.approvedVersion !== null });
    setStatus('note' in decision ? 'returned' : 'approved');
    setReturning(false);
    router.refresh();
  };

  return {
    returning,
    note,
    pending,
    status,
    decided,
    approving,
    onApprovingChange: (open: boolean) => {
      setApproving(open);
      if (open) setStatus('idle');
    },
    reason,
    onReason: setReason,
    onApprove: () => decide({ reason }),
    onStartReturn: () => {
      setStatus('idle');
      setReturning(true);
    },
    onCancelReturn: () => setReturning(false),
    onNote: setNote,
    onReturn: () => void decide({ note }),
    onSend: () =>
      startTransition(async () => {
        if (!review) return;
        let result;
        try {
          result = await sendRubricForApproval(review.versionId);
        } catch (error) {
          return setStatus(saveFailure(error));
        }
        if (!result.ok) return setStatus('failed');
        setStatus('sent');
        router.refresh();
      }),
  };
}
