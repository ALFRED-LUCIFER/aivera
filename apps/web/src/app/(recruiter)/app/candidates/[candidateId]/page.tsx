import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata } from 'next';
import { forbidden, notFound } from 'next/navigation';
import { CandidateProfile } from '@/features/evidence-profile/components/CandidateProfile.tsx';
import { loadProfile } from '@/features/evidence-profile/services/loadProfile.ts';
import { loadQuestions } from '@/features/evidence-profile/services/loadQuestions.ts';
import { mayOpen } from '@/features/shell/services/request.ts';
import { ProfileQuestions } from './ProfileQuestions.tsx';

// The title names the page, never the person: it reaches the browser's history (AGENTS.md 1.2).
export const generateMetadata = async (): Promise<Metadata> => ({
  title: (await getTranslations(defaultLocale, defaultTimeZone))('candidateProfile.title'),
});

// The top of the candidate evidence profile for one job (AIV-P1-043), at /app/candidates/[candidateId]?job=[jobId].
// No requireScreen('candidates'): that section is the all-candidates list (AIV-P1-048), for admins and recruiters only.
// This page is open to a job's granted hiring owners and interviewers too, as the job pages are, and loadProfile decides
// through the member's job scope: 403 for an ungranted job, 404 for a candidate the job does not have.
export default async function CandidateProfilePage({
  params,
  searchParams,
}: PageProps<'/app/candidates/[candidateId]'>) {
  const job = (await searchParams)['job'];
  const { candidateId } = await params;
  const profile = await loadProfile(candidateId, typeof job === 'string' ? job : undefined);
  // No workspace: the recruiter layout shows the create-workspace page instead.
  if (!profile) return null;
  if (profile === 'forbidden') forbidden();
  if (profile === 'notFound') notFound();
  // "Needs live verification" (AIV-P1-113): read only after the profile's own checks passed; null when the candidate
  // has no result on the approved rubric version, so there is nothing to verify yet.
  const questions = await loadQuestions(candidateId, profile.jobId);
  return (
    <CandidateProfile view={{ status: 'ready', ...profile }} linkCandidates={await mayOpen('candidates')}>
      {questions && (
        // Keyed by candidate and job: another job's profile (only `?job=` changes) starts from its own stored set.
        <ProfileQuestions
          key={`${candidateId}:${profile.jobId}`}
          candidateId={candidateId}
          jobId={profile.jobId}
          initial={questions}
        />
      )}
    </CandidateProfile>
  );
}
