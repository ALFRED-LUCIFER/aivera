import { notFound } from 'next/navigation';
import { Rubric } from '@/features/rubric/components/Rubric.tsx';
import { reviewLink } from '@/features/rubric/domain/rubric.ts';
import { loadRubric } from '@/features/rubric/services/loadRubric.ts';
import { loadJob } from '../loadJob.ts';
import { jobPageMetadata } from '../metadata.ts';
import { RubricEditable } from './RubricEditable.tsx';

export const generateMetadata = jobPageMetadata('rubric');

// Loading and error states: loading.tsx and error.tsx beside this page. Hiring owners and interviewers granted the job
// read it too; listRubricVersions checks job.view itself, not only the layout. Admins and recruiters also edit it; the
// job's hiring owner, or an admin acting as owner, approves or returns the version awaiting approval (AIV-P1-014).
export default async function RubricPage({ params, searchParams }: PageProps<'/app/jobs/[jobId]/rubric'>) {
  const { jobId } = await params;
  const [loaded, job] = await Promise.all([loadRubric(jobId), loadJob(jobId)]);
  if (!loaded) notFound();
  if (!loaded.canEdit && !loaded.approver) return <Rubric state={{ status: 'ready', rubric: loaded.rubric }} />;
  const hiringOwner = (job && 'header' in job && job.hiringOwner) || null;
  return (
    <RubricEditable
      jobId={jobId}
      rubric={loaded.rubric}
      hiringOwner={hiringOwner}
      canEdit={loaded.canEdit}
      approver={loaded.approver}
      link={reviewLink(await searchParams)}
    />
  );
}
