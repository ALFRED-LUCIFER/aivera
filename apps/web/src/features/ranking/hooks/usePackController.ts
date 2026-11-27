import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { addToPackSchema, NEW_PACK, packPreview, type PackView } from '../domain/pack.ts';
import type { RankingData } from '../domain/ranking.ts';
import * as actions from '../services/addToDecisionPack.ts';

/**
 * "Add to decision pack" on the ranking (AIV-P2-010): the preview of the people selected when it opened, the pack to
 * add them to (the newest undecided one, or a new one with a name), and Confirm, the only thing that writes. A refused
 * or failed save keeps the preview so the person can try again; a confirmed one clears the selection.
 */
export function usePackController(
  { jobId, rows, packs = [] }: Pick<RankingData, 'jobId' | 'rows' | 'packs'>,
  clearSelection: () => void,
  services: Pick<typeof actions, 'addToDecisionPack'> = actions,
): PackView {
  const router = useRouter();
  const [ids, setIds] = useState<readonly string[] | null>(null);
  const [target, setTarget] = useState(NEW_PACK);
  const [name, setName] = useState('');
  const [error, setError] = useState<PackView['error']>(null);
  const [done, setDone] = useState<PackView['done']>(null);
  const existing = packs.find((p) => p.id === target);
  const preview = ids && packPreview(rows, ids, existing);
  const input = {
    jobId,
    applicationIds: preview?.toAdd ?? [],
    pack: existing ? { packId: existing.id } : { name },
  };

  return {
    packs,
    preview,
    onPreview(selected) {
      setIds(selected);
      setTarget(packs[0]?.id ?? NEW_PACK);
      setName('');
      setError(null);
      setDone(null);
    },
    target,
    onTargetChange: setTarget,
    name,
    onNameChange: setName,
    canConfirm: addToPackSchema.safeParse(input).success,
    error,
    done,
    async onConfirm() {
      const result = await services.addToDecisionPack(input);
      if (!result.ok) {
        setError(result.error === 'notOnJob' ? 'notOnJob' : 'failed');
        // Rejecting shows the card's "Nothing was changed" message and keeps the preview open.
        throw new Error(result.error);
      }
      setIds(null);
      setDone({ packId: result.packId, added: result.added, name: existing?.name ?? name.trim() });
      // Or the next bulk action would start from the rows just confirmed (AGENTS.md 1.5).
      clearSelection();
      router.refresh();
    },
    onCancel: () => setIds(null),
  };
}
