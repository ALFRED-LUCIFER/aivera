import { redirect } from 'next/navigation';

// A job opens on its rubric; the Jobs list links straight to the rubric or the ranking.
export default async function JobPage({ params }: PageProps<'/app/jobs/[jobId]'>) {
  redirect(`/app/jobs/${(await params).jobId}/rubric`);
}
