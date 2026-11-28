'use client';

import { useTranslations } from '@credalent/i18n/react';
import { ScoreWithUncertainty, ValueBasis } from '@credalent/ui';
import { CvStatusLine } from '@/features/evidence-profile';
import type { CvRetryView } from '@/features/evidence-profile/domain/cvStatus.ts';
import { rowName, type CandidateRow } from '../domain/ranking.ts';

// The ranked table's score and "Not yet available" (AIV-P1-034), shared with the choose-for-interview preview.

export function NotYet() {
  const t = useTranslations('ranking');
  return <ValueBasis basis="not-available" label={t('notYetAvailable')} />;
}

export function ScoreCell({ row, retry }: { row: CandidateRow; retry?: CvRetryView | undefined }) {
  const t = useTranslations();
  // Not scored yet: the row says where its CV is and, where a person can act, offers "Try again" (AIV-P1-165 §7).
  if (!row.score && row.cv) return <CvStatusLine cv={row.cv} name={rowName(row, t('ranking.unnamed'))} retry={retry} />;
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
