import { notFound } from 'next/navigation';
import { seesInterview } from '@/features/scorecard/services/loadScorecard.ts';
import { requireScreen } from '@/features/shell/services/request.ts';

// Decided here, above the page's loading boundary, so an interview the member may not see (another workspace's, a job
// they are not granted, another interviewer's) or a malformed id is a real 404 response, not a streamed 200.
export default async function ScorecardLayout({ children, params }: LayoutProps<'/app/interviews/[interviewId]'>) {
  await requireScreen('interviews');
  // Null with no workspace: the recruiter layout shows the create-workspace page instead.
  if ((await seesInterview((await params).interviewId)) === false) notFound();
  return children;
}
