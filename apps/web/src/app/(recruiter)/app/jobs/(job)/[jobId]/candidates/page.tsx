import { notFound } from 'next/navigation';
import { loadRanking } from '@/features/ranking/services/loadRanking.ts';
import { jobPageMetadata } from '../metadata.ts';
import { Ranking } from './Ranking.tsx';

export const generateMetadata = jobPageMetadata('candidates');

// The ranked candidates (AIV-P1-034). Loading and error states: loading.tsx and error.tsx beside this page. Intake and
// assessment check the member's job scope themselves, not only the layout. "Add candidates" in the job header opens
// Bring in candidates (AIV-P1-101), which holds the "Add applicants" upload (AIV-P1-019).
export default async function CandidatesPage({ params }: PageProps<'/app/jobs/[jobId]/candidates'>) {
  const ranking = await loadRanking((await params).jobId);
  // No workspace: the recruiter layout shows the create-workspace page instead.
  if (!ranking) return null;
  if (ranking === 'notFound') notFound();
  return <Ranking {...ranking} />;
}
