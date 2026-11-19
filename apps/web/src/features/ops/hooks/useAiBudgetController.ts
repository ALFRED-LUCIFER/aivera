import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AI_DAILY_TOKEN_BUDGET, aiBudgetError, parseTokens, type AiBudgetView } from '../domain/aiBudget.ts';
import type { WorkspaceRow } from '../domain/workspaces.ts';
import { setAiBudget } from '../services/setAiBudget.ts';

/**
 * The daily AI budget form (AIV-P2-038): checks the change, shows it in the preview, and applies it only on Confirm
 * (AGENTS.md 1.5). After the change the page reloads its facts from the server.
 */
export function useAiBudgetController(workspaceId: string, ai: NonNullable<WorkspaceRow['ai']>): AiBudgetView {
  const router = useRouter();
  const [budget, setBudget] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<AiBudgetView['error']>(null);
  const [preview, setPreview] = useState<AiBudgetView['preview']>(null);
  const [saved, setSaved] = useState<AiBudgetView['saved']>(undefined);

  const open = (to: number | null) => {
    const problem = aiBudgetError({ workspaceId, dailyBudget: to, reason });
    setError(problem);
    if (!problem) setPreview({ from: ai.dailyBudget, to: to ?? AI_DAILY_TOKEN_BUDGET.default, reset: to === null });
  };

  return {
    budget,
    reason,
    error,
    onBudgetChange: setBudget,
    onReasonChange: setReason,
    onPreview: () => open(parseTokens(budget)),
    onPreviewReset: () => open(null),
    preview,
    async onConfirm() {
      if (!preview) return;
      const dailyBudget = preview.reset ? null : preview.to;
      await setAiBudget({ workspaceId, dailyBudget, reason });
      setPreview(null);
      setSaved(dailyBudget);
      setBudget('');
      setReason('');
      router.refresh();
    },
    onCancel: () => setPreview(null),
    saved,
  };
}
