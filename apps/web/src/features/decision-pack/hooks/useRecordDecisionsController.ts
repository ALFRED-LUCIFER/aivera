import type { DecisionValue } from '@credalent/decisions';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { recordDecisionsSchema, undecided, type PackPage, type RecordView } from '../domain/pack.ts';
import * as actions from '../services/recordDecisions.ts';

/**
 * "Record the decision" on the pack (AIV-P2-012): the hiring owner's choice per member, none chosen at first (Credalent's
 * recommendation decides nothing), then "Record decisions" checks every member has one and opens the preview with the
 * required reason. Confirm is the only thing that writes. A refused or failed record keeps the preview and reason so the
 * person can try again; a recorded one re-reads the page, which shows the decisions read-only.
 */
export function useRecordDecisionsController(
  { packId, members }: Pick<PackPage, 'packId' | 'members'>,
  services: Pick<typeof actions, 'recordDecisions'> = actions,
): RecordView {
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, DecisionValue>>({});
  const [checked, setChecked] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<RecordView['error']>(null);
  const [recorded, setRecorded] = useState(false);
  const missing = checked ? undecided(members, choices) : [];

  return {
    choices,
    onChoose: (candidateId, decision) => setChoices((now) => ({ ...now, [candidateId]: decision })),
    missing,
    onRecord() {
      setChecked(true);
      setError(null);
      setPreviewing(undecided(members, choices).length === 0);
    },
    previewing,
    reason,
    onReasonChange: setReason,
    reasonValid: recordDecisionsSchema.shape.reason.safeParse(reason).success,
    error,
    recorded,
    async onConfirm() {
      const result = await services.recordDecisions({
        packId,
        decisions: members.map((m) => ({ candidateId: m.candidateId, decision: choices[m.candidateId] })),
        reason,
      });
      if (!result.ok) {
        setError(result.error === 'decided' ? 'decided' : 'failed');
        // Rejecting shows the card's "Nothing was recorded" message and keeps the preview open.
        throw new Error(result.error);
      }
      setPreviewing(false);
      setRecorded(true);
      router.refresh();
    },
    onCancel: () => setPreviewing(false),
  };
}
