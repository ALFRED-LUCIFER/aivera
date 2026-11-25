import { notFound } from 'next/navigation';
import { PackList } from '@/features/decision-pack/components/PackList.tsx';
import { loadJobPacks } from '@/features/decision-pack/services/loadPack.ts';
import { jobPageMetadata } from '../metadata.ts';

export const generateMetadata = jobPageMetadata('pack');

// The job's Decision tab (AIV-P2-010): its undecided packs, each opening its page, or why there is none yet.
// shortcut: decided packs and the hiring owner's decisions are not listed; the pack's content and decisions are
// AIV-P2-011 (#125).
export default async function JobPackPage({ params }: PageProps<'/app/jobs/[jobId]/pack'>) {
  const { jobId } = await params;
  const packs = await loadJobPacks(jobId);
  // No workspace: the recruiter layout shows the create-workspace page instead.
  if (!packs) return null;
  if (packs === 'notFound') notFound();
  return <PackList jobId={jobId} packs={packs} />;
}
