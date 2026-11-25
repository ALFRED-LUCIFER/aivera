'use client';

import { useTranslations } from '@credalent/i18n/react';
import { ScoreWithUncertainty, ValueBasis } from '@credalent/ui';
import type { CandidateRow } from '../domain/ranking.ts';

// The ranked table's score and "Not yet available" (AIV-P1-034), shared with the choose-for-interview preview.

export function NotYet() {
  const t = useTranslations('ranking');
  return <ValueBasis basis="not-available" label={t('notYetAvailable')} />;
}

export function ScoreCell({ row }: { row: CandidateRow }) {
  const t = useTranslations();
  if (!row.score)
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        {t('ranking.notScored')}
        <NotYet />
      </span>
    );
  return (
    <span className="block min-w-44">
      <ScoreWithUncertainty
        compact
        backed={row.score.backedScore}
        upTo={row.score.upperBound}
        backedLabel={(backed) => t('score.backed', { backed })}
        captionLabel={(backed, upTo) => t('score.backedUpToCompact', { backed, upTo })}
        upToLabel={(upTo) => t('score.upToCompact', { upTo })}
        unavailableLabel={t('score.unavailable')}
      />
    </span>
  );
}
