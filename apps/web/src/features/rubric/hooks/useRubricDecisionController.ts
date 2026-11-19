import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ReviewView, RubricDecisionView } from '../domain/rubric.ts';
import { decideRubric } from '../services/decideRubric.ts';

/**
 * The hiring owner's approval panel (AIV-P1-014): approve the version awaiting approval, or write a note and return it.
 * Nothing changes on the server until they choose "Approve version N" or "Return version N".
 */
export function useRubricDecisionController(jobId: string, review: ReviewView | null): RubricDecisionView {
  const router = useRouter();
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<RubricDecisionView['status']>('idle');
  const [decided, setDecided] = useState<RubricDecisionView['decided']>(null);
  const [pending, startTransition] = useTransition();

  const decide = (returnNote?: string) =>
    startTransition(async () => {
      if (!review) return;
      const { versionId, revision } = review;
      const result = await decideRubric({
        jobId,
        versionId,
        revision,
        ...(returnNote !== undefined && { note: returnNote }),
      });
      if ('error' in result) return setStatus(result.error);
      setDecided({ version: review.version, inForce: review.approvedVersion !== null });
      setStatus(returnNote === undefined ? 'approved' : 'returned');
      setReturning(false);
      router.refresh();
    });

  return {
    returning,
    note,
    pending,
    status,
    decided,
    onApprove: () => decide(),
    onStartReturn: () => {
      setStatus('idle');
      setReturning(true);
    },
    onCancelReturn: () => setReturning(false),
    onNote: setNote,
    onReturn: () => decide(note),
  };
}
