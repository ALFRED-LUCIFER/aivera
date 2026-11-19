import { useState, useTransition } from 'react';
import { sendRubricForApproval } from '@/features/rubric/index.ts';

/** "Send rubric for approval" after Add a job (AIV-P1-014). Nothing is sent until the recruiter chooses it. */
export function useSendRubricController(rubricVersionId: string | undefined) {
  const [status, setStatus] = useState<'idle' | 'sent' | 'sentNoOwner' | 'failed'>('idle');
  const [pending, startTransition] = useTransition();
  return {
    status,
    pending,
    onSend: () =>
      startTransition(async () => {
        if (!rubricVersionId) return setStatus('failed');
        const result = await sendRubricForApproval(rubricVersionId);
        setStatus(!result.ok ? 'failed' : result.emailed ? 'sent' : 'sentNoOwner');
      }),
  };
}
