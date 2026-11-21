import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { CatalogueSaveResult, Refusal } from '../domain/catalogueEditor.ts';
import { EVAL_POLL_MS, type CatalogueEvalViewModel, type EvalView } from '../domain/catalogueEval.ts';
import { runCatalogueEvalAction } from '../services/editCatalogue.ts';

/**
 * "Run the eval" on the draft (AIV-P2-048): asks for a run on the draft's version and the revision the page shows, then
 * reloads the page; while a run is running, the page reloads every few seconds to show its result.
 */
export function useCatalogueEvalController(
  draft: { version: number; revision: number },
  view: EvalView,
): CatalogueEvalViewModel {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Refusal | null>(null);
  const running = view.status === 'running';

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), EVAL_POLL_MS);
    return () => clearInterval(timer);
  }, [running, router]);

  return {
    view,
    pending,
    error,
    onRun: async () => {
      setPending(true);
      setError(null);
      const result = await runCatalogueEvalAction({ version: draft.version, revision: draft.revision }).catch(
        (): CatalogueSaveResult => ({ ok: false, error: 'failed' }),
      );
      setPending(false);
      if (result.ok) router.refresh();
      else setError(result);
    },
  };
}
