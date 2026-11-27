'use client';

import { useTranslations } from '@credalent/i18n/react';
import { roundLabelKey, type CandidateRow } from '../domain/ranking.ts';

/**
 * Where an applicant is: their current interview round ("Round 1 on 20 Nov", "Round 1 today, 14:00", "Round 1
 * complete", AIV-P2-007), else their intake stage ("New"). Shared by the ranking and Candidates (all jobs).
 */
export function StageLine({ row }: { row: Pick<CandidateRow, 'stage' | 'interview'> }) {
  const t = useTranslations('ranking');
  const { interview } = row;
  if (!interview) return t(`stages.${row.stage}`);
  return t(`roundLine.${roundLabelKey(interview)}`, {
    round: t(`roundShort.${interview.round}`),
    // Unused by the lines with no time.
    at: new Date(interview.scheduledAt ?? 0),
  });
}
