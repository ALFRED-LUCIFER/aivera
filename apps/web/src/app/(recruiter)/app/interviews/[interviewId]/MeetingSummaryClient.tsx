'use client';

import { useEffect } from 'react';
import { MeetingSummary } from '@/features/interview-summary/components/MeetingSummary.tsx';
import type { SummaryPanel } from '@/features/interview-summary/domain/summary.ts';
import { useSummaryController } from '@/features/interview-summary/hooks/useSummaryController.ts';

/** The meeting-summary panel under the scorecard's competencies (AIV-P1-115); says when its preview card opens or closes. */
export function MeetingSummaryClient({
  data,
  onProposalsOpen,
}: {
  data: SummaryPanel;
  onProposalsOpen: (open: boolean) => void;
}) {
  const view = useSummaryController(data);
  const open = view.panel.summary?.status === 'proposed';
  useEffect(() => onProposalsOpen(open), [open, onProposalsOpen]);
  return <MeetingSummary view={view} />;
}
