'use client';

import { useState } from 'react';
import type { SummaryPanel } from '@/features/interview-summary/domain/summary.ts';
import { Scorecard } from '@/features/scorecard/components/Scorecard.tsx';
import type { ScorecardData } from '@/features/scorecard/domain/scorecard.ts';
import { useScorecardController } from '@/features/scorecard/hooks/useScorecardController.ts';
import { MeetingSummaryClient } from './MeetingSummaryClient.tsx';

/**
 * The scorecard form with its draft (AIV-P2-004) and, for the people who may act on it, the meeting-summary panel under
 * the competencies (AIV-P1-115). While the panel's preview card is open, its "Apply" is the view's one primary button.
 */
export function ScorecardClient({ data, summary = null }: { data: ScorecardData; summary?: SummaryPanel | null }) {
  const [proposalsOpen, setProposalsOpen] = useState(summary?.summary?.status === 'proposed');
  return (
    <Scorecard view={{ status: 'ready', ...data, ...useScorecardController(data) }} quietSubmit={proposalsOpen}>
      {summary && <MeetingSummaryClient data={summary} onProposalsOpen={setProposalsOpen} />}
    </Scorecard>
  );
}
