import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import {
  LIVE_REFRESH_LIMIT_MS,
  LIVE_REFRESH_MS,
  retryKey,
  type CvRetryView,
  type RetryResult,
} from '../domain/cvStatus.ts';
import { retryCv } from '../services/retryCv.ts';

/**
 * "Try again" on a CV that could not be read or assessed (AIV-P1-134, AIV-P1-165), for the ranking and the profile;
 * the page then refreshes and says "Reading the CV…" or "Assessing the evidence…".
 */
export function useCvRetryController(): CvRetryView {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<{ key: string; error: 'refused' | 'failed' } | null>(null);
  return {
    pending,
    problemFor: (target) => (problem?.key === retryKey(target) ? problem.error : null),
    onRetry: (target) =>
      start(async () => {
        // A throw would reach the error boundary and take the page with it.
        const result: RetryResult = await retryCv(target).catch(() => ({ ok: false, error: 'failed' }) as const);
        // Refused: it is no longer failed (another retry, or the worker got there first); the refresh shows what it is.
        setProblem(
          result.ok ? null : { key: retryKey(target), error: result.error === 'refused' ? 'refused' : 'failed' },
        );
        router.refresh();
      }),
  };
}

/**
 * Refreshes the page's server data every few seconds while `active` (a CV is being read or assessed), so the ranking
 * and an open profile update on their own (AIV-P1-165 §7; the pattern of useCatalogueEvalController). It stops after
 * `LIVE_REFRESH_LIMIT_MS`, so a CV stuck where the page cannot see it does not reload the ranking forever.
 * shortcut: a fixed limit, then nothing until a reload; back off instead if recruiters leave pages open that long.
 */
export function useLiveRefresh(active: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let ticks = 0;
    const timer = setInterval(() => {
      router.refresh();
      if (++ticks * LIVE_REFRESH_MS >= LIVE_REFRESH_LIMIT_MS) clearInterval(timer);
    }, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, router]);
}
