import { notFound } from 'next/navigation';
import { PackPreview } from '@/features/decision-pack/components/PackPreview.tsx';
import { loadPackPreview } from '@/features/decision-pack/services/loadPack.ts';
import { jobPageMetadata } from '../../../metadata.ts';

export const generateMetadata = jobPageMetadata('pack');

// The pack as the hiring owner will see it (AIV-P1-116), shown inside Credalent only: nothing is sent or downloaded.
// The job layout refuses a member the job is not granted to; the decisions module checks the job scope itself.
export default async function PackPreviewPage({ params }: PageProps<'/app/jobs/[jobId]/packs/[packId]/preview'>) {
  const { jobId, packId } = await params;
  const preview = await loadPackPreview(jobId, packId);
  // No workspace: the recruiter layout shows the create-workspace page instead.
  if (!preview) return null;
  if (preview === 'notFound') notFound();
  return <PackPreview jobId={jobId} packId={packId} preview={preview} />;
}
