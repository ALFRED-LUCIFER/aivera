import { notFound } from 'next/navigation';
import { Rubric } from '@/features/rubric/components/Rubric.tsx';
import { loadRubric } from '@/features/rubric/services/loadRubric.ts';
import { jobPageMetadata } from '../metadata.ts';

export const generateMetadata = jobPageMetadata('rubric');

// Loading and error states: loading.tsx and error.tsx beside this page. Hiring owners and interviewers granted the job
// read it too; listRubricVersions checks job.view itself, not only the layout.
export default async function RubricPage({ params }: PageProps<'/app/jobs/[jobId]/rubric'>) {
  const rubric = await loadRubric((await params).jobId);
  if (!rubric) notFound();
  return <Rubric state={{ status: 'ready', rubric }} />;
}
