import { loadJob } from '../loadJob.ts';
import { jobPageMetadata } from '../metadata.ts';

export const generateMetadata = jobPageMetadata('description');

// The job description as it was added; the layout has already refused a job this member cannot see.
export default async function DescriptionPage({ params }: PageProps<'/app/jobs/[jobId]/description'>) {
  const loaded = await loadJob((await params).jobId);
  if (!loaded || !('header' in loaded)) return null;
  return <p className="max-w-[72ch] text-body whitespace-pre-line text-text">{loaded.header.job.description}</p>;
}
