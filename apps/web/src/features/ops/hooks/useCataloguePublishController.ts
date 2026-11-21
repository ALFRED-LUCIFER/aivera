import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CatalogueSaveResult, DraftModel, Refusal } from '../domain/catalogueEditor.ts';
import type { EvalView } from '../domain/catalogueEval.ts';
import { publishBlock, type CataloguePublishViewModel } from '../domain/cataloguePublish.ts';
import { discardCatalogueAction, publishCatalogueAction } from '../services/editCatalogue.ts';

/**
 * "Review and publish" and "Discard draft" (AIV-P2-049): each names the draft's version and the revision the page shows,
 * so a change made meanwhile refuses it. A refusal rejects the card's confirm (it shows the message, nothing changed)
 * and reloads the page, so a stale card shows the draft as it is now.
 */
export function useCataloguePublishController(
  draft: DraftModel,
  publishedVersion: number,
  evaluation: EvalView,
): CataloguePublishViewModel {
  const router = useRouter();
  const [publishOpen, setPublishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [publishError, setPublishError] = useState<Refusal | null>(null);
  const [discardError, setDiscardError] = useState<Refusal | null>(null);
  const { version, revision } = draft;

  const send = async (
    action: () => Promise<CatalogueSaveResult>,
    setError: (error: Refusal | null) => void,
    close: () => void,
  ) => {
    const result = await action().catch((): CatalogueSaveResult => ({ ok: false, error: 'failed' }));
    // A success already carries the new page (the action revalidates it); a second render only delays it.
    if (!result.ok) {
      router.refresh();
      setError(result);
      throw new Error(result.error);
    }
    close();
  };

  return {
    version,
    publishedVersion,
    changes: draft.changes,
    publish: {
      open: publishOpen,
      onOpenChange: (open) => {
        setPublishOpen(open);
        setPublishError(null);
      },
      reason,
      onReasonChange: setReason,
      block: publishBlock(draft.changes, evaluation, reason),
      error: publishError,
      onConfirm: () =>
        send(
          () => publishCatalogueAction({ version, revision, reason }),
          setPublishError,
          () => setPublishOpen(false),
        ),
    },
    discard: {
      open: discardOpen,
      onOpenChange: (open) => {
        setDiscardOpen(open);
        setDiscardError(null);
      },
      error: discardError,
      onConfirm: () =>
        send(
          () => discardCatalogueAction({ version, revision }),
          setDiscardError,
          () => setDiscardOpen(false),
        ),
    },
  };
}
