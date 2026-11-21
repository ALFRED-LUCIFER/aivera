import { notFound } from 'next/navigation';
import { ApplicantList } from '@/features/add-applicants/components/ApplicantList.tsx';
import { loadApplicants } from '@/features/add-applicants/services/loadApplicants.ts';
import { currentMembership } from '@/server/workspace';
import { jobPageMetadata } from '../metadata.ts';
import { AddApplicants } from './AddApplicants.tsx';

export const generateMetadata = jobPageMetadata('candidates');

// shortcut: a plain applicant list (AIV-P1-086) until the ranked candidates table (AIV-P1-034) replaces it.
// Loading and error states: loading.tsx and error.tsx beside this page. listApplicationsForJob checks the member's job
// scope itself, not only the layout. "Add applicants" (AIV-P1-019) is offered to admins and recruiters; the action
// authorises on the server regardless.
export default async function CandidatesPage({ params }: PageProps<'/app/jobs/[jobId]/candidates'>) {
  const { jobId } = await params;
  const [applicants, membership] = await Promise.all([loadApplicants(jobId), currentMembership()]);
  if (!applicants) notFound();
  const canAdd = membership?.role === 'admin' || membership?.role === 'recruiter';
  return (
    <div className="flex flex-col items-start gap-4">
      {canAdd && <AddApplicants jobId={jobId} />}
      <ApplicantList view={{ status: 'ready', rows: applicants }} />
    </div>
  );
}
