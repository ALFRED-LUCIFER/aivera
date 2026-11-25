import { summaryTextSchema, type SummaryPreview } from '@credalent/interviews';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  errorKey,
  includedByDefault,
  type SummaryErrorKey,
  type SummaryOutcome,
  type SummaryPanel,
} from '../domain/summary.ts';
import {
  applySummary,
  declineSummary,
  previewSummary,
  refreshSummary,
  submitSummary,
} from '../services/summaryActions.ts';

/** How often the page asks whether the worker has finished analysing. */
const POLL_MS = 3000;

/** What the person has ticked and written for one proposal set; it starts again when another set arrives. */
type Decision = {
  of: string;
  included: string[];
  reasons: Record<string, string>;
  preview: SummaryPreview | null;
};

const decisionFor = (panel: SummaryPanel): Decision => {
  const proposals = panel.summary?.proposals ?? [];
  return {
    of: `${panel.summary?.summaryId}:${panel.summary?.status}`,
    included: includedByDefault(proposals),
    reasons: Object.fromEntries(proposals.map((p) => [p.competencyId, p.reason ?? ''])),
    preview: panel.summary?.preview ?? null,
  };
};

/**
 * The meeting-summary panel (AIV-P1-115): paste and analyse, then tick, give reasons, and apply or decline. The worker
 * analyses, so while a summary is `analysing` the panel asks the server again every few seconds. Nothing here changes
 * a score but `onApply`, which sends back exactly the preview the person saw.
 */
// shortcut: polling, not a push: one small server action every 3 s while analysing, which a model call makes a few
// seconds long; move to a stream if the pilot shows many open pages waiting.
export function useSummaryController(initial: SummaryPanel) {
  const router = useRouter();
  const [panel, setPanel] = useState(initial);
  const [text, setText] = useState('');
  const [error, setError] = useState<SummaryErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState(() => decisionFor(initial));
  // Another proposal set (or its decision) arrived: start from its defaults, not the last set's ticks.
  if (decision.of !== decisionFor(panel).of) setDecision(decisionFor(panel));

  const status = panel.summary?.status;
  const { interviewId } = panel;
  const take = (outcome: SummaryOutcome | null) => {
    if (!outcome) return;
    if ('error' in outcome) return setError(outcome.error);
    setError(null);
    setPanel(outcome.panel);
  };

  useEffect(() => {
    if (status !== 'analysing') return;
    const timer = setInterval(() => {
      // A failed poll is tried again on the next tick; the summary is stored either way.
      void refreshSummary(interviewId).then(
        (outcome) => outcome && 'panel' in outcome && setPanel(outcome.panel),
        () => undefined,
      );
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [status, interviewId]);

  const act = async (action: () => Promise<SummaryOutcome | null>) => {
    setBusy(true);
    // A throw would reach the error boundary and take the typed text with it.
    const outcome = await action().catch((): SummaryOutcome => ({ error: 'failed' }));
    setBusy(false);
    take(outcome);
    return outcome !== null && 'panel' in outcome;
  };

  const preview = async (included: string[]) => {
    if (!panel.summary || included.length === 0) return null;
    const outcome = await previewSummary({ summaryId: panel.summary.summaryId, competencyIds: included }).catch(() => ({
      error: 'failed' as const,
    }));
    if ('error' in outcome) {
      setError(outcome.error);
      return null;
    }
    return outcome.preview;
  };

  const reasonMissing = decision.included.some((id) => !decision.reasons[id]?.trim());
  return {
    panel,
    text,
    error,
    busy,
    included: decision.included,
    reasons: decision.reasons,
    preview: decision.preview,
    reasonMissing,
    onText: setText,
    onAnalyse: async () => {
      const checked = summaryTextSchema.safeParse(text);
      if (!checked.success) return setError(errorKey(checked.error.issues[0]?.message ?? ''));
      if (await act(() => submitSummary({ interviewId, text }))) setText('');
    },
    /** Ticks or unticks one change and previews the backed score for what is now ticked. */
    onInclude: async (competencyId: string, on: boolean) => {
      const included = on
        ? [...decision.included, competencyId]
        : decision.included.filter((id) => id !== competencyId);
      // No preview until the new one arrives, so "Apply" can never send the last set's.
      setDecision({ ...decision, included, preview: null });
      const next = await preview(included);
      setDecision((current) => (current.included === included ? { ...current, preview: next } : current));
    },
    onReason: (competencyId: string, reason: string) =>
      setDecision((current) => ({ ...current, reasons: { ...current.reasons, [competencyId]: reason } })),
    /** Rejects when nothing was applied, so the preview card says so and can be confirmed again. */
    onApply: async () => {
      const { summary } = panel;
      if (!summary || !decision.preview || reasonMissing) throw new Error('nothing to apply');
      const applied = await act(() =>
        applySummary({
          interviewId,
          summaryId: summary.summaryId,
          previewId: decision.preview?.previewId,
          changes: decision.included.map((competencyId) => ({
            competencyId,
            reason: decision.reasons[competencyId] ?? '',
          })),
        }),
      );
      if (!applied) {
        // The assessment may have moved: read the proposals again and start from their new preview.
        const fresh = await refreshSummary(interviewId).catch(() => null);
        if (fresh && 'panel' in fresh) {
          setPanel(fresh.panel);
          setDecision(decisionFor(fresh.panel));
        }
        throw new Error('not applied');
      }
      // The page's own "Evidence assessed · backed score" line reads the new snapshot.
      router.refresh();
    },
    onDecline: () =>
      void (panel.summary && act(() => declineSummary({ interviewId, summaryId: panel.summary?.summaryId }))),
    onRetryPreview: () => void act(() => refreshSummary(interviewId)),
  };
}
