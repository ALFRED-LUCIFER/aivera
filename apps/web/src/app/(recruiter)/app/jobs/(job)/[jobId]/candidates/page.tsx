import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { EmptyStage } from '@/features/job-header/components/EmptyStage.tsx';
import { currentMembership } from '@/server/workspace';
import { jobPageMetadata } from '../metadata.ts';
import { AddApplicants } from './AddApplicants.tsx';

export const generateMetadata = jobPageMetadata('candidates');

// shortcut: says why it is empty until the ranked candidates table (AIV-P1-034) replaces it.
// "Add applicants" (AIV-P1-019) is offered to admins and recruiters; the action authorises on the server regardless.
export default async function CandidatesPage({ params }: PageProps<'/app/jobs/[jobId]/candidates'>) {
  const [{ jobId }, t, membership] = await Promise.all([
    params,
    getTranslations(defaultLocale, defaultTimeZone),
    currentMembership(),
  ]);
  const canAdd = membership?.role === 'admin' || membership?.role === 'recruiter';
  return (
    <div className="flex flex-col items-start gap-4">
      {canAdd && <AddApplicants jobId={jobId} />}
      <EmptyStage message={t('jobHeader.empty.candidates')} />
    </div>
  );
}
