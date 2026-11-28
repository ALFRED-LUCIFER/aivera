'use client';

import { useTranslations } from '@credalent/i18n/react';
import type { ReactNode } from 'react';
import { Compare } from '@/features/compare/components/Compare.tsx';
import type { CompareData } from '@/features/compare/domain/compare.ts';
import { usePackController } from '@/features/ranking';

/**
 * The comparison with "Add these to a decision pack" (AIV-P1-165 §10): the ranking's preview-confirm for the compared
 * candidates, offered only when the server gave this member the action (admins and recruiters, AGENTS.md 1.3).
 */
export function CompareClient({ view, children }: { view: CompareData; children?: ReactNode }) {
  const t = useTranslations('ranking');
  const adding = view.status === 'ready' ? view.pack : null;
  const pack = usePackController(
    { jobId: view.jobId, rows: adding?.rows ?? [], packs: adding?.packs ?? [] },
    t('pack.defaultReason'),
    // Nothing is ticked here: the compared candidates are the page's address.
    () => {},
  );
  return (
    <Compare view={view} pack={adding ? pack : undefined}>
      {children}
    </Compare>
  );
}
