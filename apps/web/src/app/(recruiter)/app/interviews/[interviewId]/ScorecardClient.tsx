'use client';

import { useState } from 'react';
import type { SummaryPanel } from '@/features/interview-summary/domain/summary.ts';
import { Scorecard } from '@/features/scorecard/components/Scorecard.tsx';
import { ScoreEffect } from '@/features/scorecard/components/ScoreEffect.tsx';
import type { ScorecardData } from '@/features/scorecard/domain/scorecard.ts';
import { useScoreEffectController } from '@/features/scorecard/hooks/useScoreEffectController.ts';
import { useScorecardController } from '@/features/scorecard/hooks/useScorecardController.ts';
import { MeetingSummaryClient } from './MeetingSummaryClient.tsx';

/**
 * The scorecard form with its draft (AIV-P2-004), the live preview of its ratings for whoever fills it in (AIV-P2-005),
 * which "Submit scorecard" applies (AIV-P2-006), and, for the people who may act on it, the meeting-summary panel under the competencies (AIV-P1-115). While the
 * panel's preview card is open, its "Apply" is the view's one primary button.
 */
export function ScorecardClient({ data, summary = null }: { data: ScorecardData; summary?: SummaryPanel | null }) {
  const [proposalsOpen, setProposalsOpen] = useState(summary?.summary?.status === 'proposed');
  const scorecard = useScorecardController(data);
  const effect = useScoreEffectController(data, scorecard.draft);
  const [first] = data.competencies;
  return (
    <Scorecard
      view={{
        status: 'ready',
        ...data,
        ...scorecard,
        // No preview, no submit: with ratings, it waits for their preview (AGENTS.md 1.5).
        previewBlock: effect.status === 'pending' || effect.status === 'unavailable' ? effect.status : null,
        // The preview shown is what the submit applies (AIV-P2-006): the assessment refuses any other.
        onSubmit: () => void scorecard.onSubmit(effect.status === 'ready' ? effect.previewId : null),
      }}
      quietSubmit={proposalsOpen}
      effect={data.canEdit && first && <ScoreEffect state={effect} first={first.name} />}
    >
      {summary && <MeetingSummaryClient data={summary} onProposalsOpen={setProposalsOpen} />}
    </Scorecard>
  );
}
