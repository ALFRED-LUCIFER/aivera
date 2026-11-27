import { notFound } from 'next/navigation';
import { loadPack } from '@/features/decision-pack/services/loadPack.ts';
import { jobPageMetadata } from '../../metadata.ts';
import { PackClient } from './PackClient.tsx';

export const generateMetadata = jobPageMetadata('pack');

// A decision pack built from the ranking (AIV-P2-010), where the hiring owner records its decisions (AIV-P2-012).
// Loading and error states: loading.tsx and error.tsx beside this page. The decisions module checks the member's job
// scope itself.
export default async function PackPage({ params }: PageProps<'/app/jobs/[jobId]/packs/[packId]'>) {
  const { jobId, packId } = await params;
  const pack = await loadPack(jobId, packId);
  // No workspace: the recruiter layout shows the create-workspace page instead.
  if (!pack) return null;
  if (pack === 'notFound') notFound();
  return <PackClient pack={pack} />;
}
