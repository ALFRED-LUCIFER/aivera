import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { nameSelfSchema, type NameSelfView } from '../domain/pack.ts';
import * as actions from '../services/nameSelfOwner.ts';

/**
 * "Record decisions yourself" on a pack whose job has no hiring owner (AIV-P1-165): a required reason, then Confirm, the
 * only thing that writes. A refused or failed save keeps the card open; a saved one reads the page again, which then
 * offers this admin the decision controls.
 */
export function useNameSelfController(
  jobId: string,
  services: Pick<typeof actions, 'nameSelfOwner'> = actions,
): NameSelfView {
  const router = useRouter();
  const [previewing, setPreviewing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<NameSelfView['error']>(null);
  return {
    previewing,
    onOpen() {
      setError(null);
      setPreviewing(true);
    },
    onCancel: () => setPreviewing(false),
    reason,
    onReasonChange: setReason,
    reasonValid: nameSelfSchema.shape.reason.safeParse(reason).success,
    error,
    async onConfirm() {
      const result = await services.nameSelfOwner({ jobId, reason });
      if (!result.ok) {
        setError(result.error === 'taken' ? 'taken' : 'failed');
        throw new Error(result.error);
      }
      setPreviewing(false);
      router.refresh();
    },
  };
}
