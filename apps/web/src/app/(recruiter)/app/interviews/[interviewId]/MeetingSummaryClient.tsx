'use client';

import { MeetingSummary } from '@/features/interview-summary/components/MeetingSummary.tsx';
import type { SummaryPanel } from '@/features/interview-summary/domain/summary.ts';
import { useSummaryController } from '@/features/interview-summary/hooks/useSummaryController.ts';

/** The meeting-summary panel under the scorecard's competencies (AIV-P1-115). */
export function MeetingSummaryClient({ data }: { data: SummaryPanel }) {
  return <MeetingSummary view={useSummaryController(data)} />;
}
