import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { choosePreview, chooseSchema, type ChooseView } from '../domain/choose.ts';
import type { RankingData } from '../domain/ranking.ts';
import * as actions from '../services/chooseForInterview.ts';

/**
 * "Choose for interview" on the ranking (AIV-P1-114): the preview of the people selected when it opened, the required
 * reason (prefilled `defaultReason`), and Confirm, the only thing that writes. A refused or failed save keeps the
 * preview and reason so the person can try again; a confirmed one clears the selection.
 */
export function useChooseController(
  { jobId, rows }: Pick<RankingData, 'jobId' | 'rows'>,
  defaultReason: string,
  clearSelection: () => void,
  services: Pick<typeof actions, 'chooseForInterview'> = actions,
): ChooseView {
  const router = useRouter();
  const [ids, setIds] = useState<readonly string[] | null>(null);
  const [reason, setReason] = useState(defaultReason);
  const [error, setError] = useState<ChooseView['error']>(null);
  const [done, setDone] = useState<number | null>(null);
  const input = { jobId, applicationIds: ids ?? [], reason };

  return {
    preview: ids && choosePreview(rows, ids),
    onPreview(selected) {
      setIds(selected);
      setReason(defaultReason);
      setError(null);
      setDone(null);
    },
    reason,
    onReasonChange: setReason,
    reasonValid: chooseSchema.shape.reason.safeParse(reason).success,
    error,
    done,
    async onConfirm() {
      const result = await services.chooseForInterview(input);
      if (!result.ok) {
        setError(result.error === 'notOnJob' ? 'notOnJob' : 'failed');
        // Rejecting shows the card's "Nothing was changed" message and keeps the preview open.
        throw new Error(result.error);
      }
      setIds(null);
      setDone(result.chosen);
      // Or the next bulk action would start from the rows just confirmed (AGENTS.md 1.5).
      clearSelection();
      router.refresh();
    },
    onCancel: () => setIds(null),
  };
}
