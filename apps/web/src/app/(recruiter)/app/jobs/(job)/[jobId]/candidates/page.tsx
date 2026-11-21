import { notFound } from 'next/navigation';
import { loadRanking } from '@/features/ranking/services/loadRanking.ts';
import { currentMembership } from '@/server/workspace';
import { jobPageMetadata } from '../metadata.ts';
import { AddApplicants } from './AddApplicants.tsx';
import { Ranking } from './Ranking.tsx';

export const generateMetadata = jobPageMetadata('candidates');

// The ranked candidates (AIV-P1-034). Loading and error states: loading.tsx and error.tsx beside this page. Intake and
// assessment check the member's job scope themselves, not only the layout. "Add applicants" (AIV-P1-019) is offered to
// admins and recruiters; the action authorises on the server regardless.
export default async function CandidatesPage({ params }: PageProps<'/app/jobs/[jobId]/candidates'>) {
  const { jobId } = await params;
  const [ranking, membership] = await Promise.all([loadRanking(jobId), currentMembership()]);
  // No workspace: the recruiter layout shows the create-workspace page instead.
  if (!ranking) return null;
  if (ranking === 'notFound') notFound();
  const canAdd = membership?.role === 'admin' || membership?.role === 'recruiter';
  return (
    <div className="flex flex-col items-start gap-4">
      {canAdd && <AddApplicants jobId={jobId} />}
      <Ranking {...ranking} />
    </div>
  );
}
