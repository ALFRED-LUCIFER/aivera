import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadSummary } from '@/features/interview-summary/services/loadSummary.ts';
import { loadScorecard } from '@/features/scorecard/services/loadScorecard.ts';
import { requireScreen } from '@/features/shell/services/request.ts';
import { MeetingSummaryClient } from './MeetingSummaryClient.tsx';
import { ScorecardClient } from './ScorecardClient.tsx';

// The title names the page, never the person: it reaches the browser's history (AGENTS.md 1.2).
export const generateMetadata = async (): Promise<Metadata> => ({
  title: (await getTranslations(defaultLocale, defaultTimeZone))('scorecard.pageTitle'),
});

// One interview's scorecard (AIV-P2-004), at /app/interviews/[interviewId]. Loading and error states: loading.tsx and
// error.tsx beside this page. Every role opens Interviews; loadScorecard decides through the interviews contract: 404
// for an interview of another workspace, of a job the member is not granted or, for an interviewer, not their own.
// It reads stored data only and calls no model. The meeting-summary panel (AIV-P1-115) goes inside <ScorecardClient>
// as its children, for the people who may act on the interview's summary: loadSummary is null for anyone else.
export default async function ScorecardPage({ params }: PageProps<'/app/interviews/[interviewId]'>) {
  await requireScreen('interviews');
  const { interviewId } = await params;
  const scorecard = await loadScorecard(interviewId);
  // No workspace: the recruiter layout shows the create-workspace page instead.
  if (!scorecard) return null;
  if (scorecard === 'notFound') notFound();
  // Keyed by interview: another interview's page starts from its own draft.
  const summary = await loadSummary(interviewId);
  return (
    <ScorecardClient key={interviewId} data={scorecard}>
      {summary && <MeetingSummaryClient data={summary} />}
    </ScorecardClient>
  );
}
