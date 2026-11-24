import { CandidateProfile } from '@/features/evidence-profile/components/CandidateProfile.tsx';

export default function CandidateProfileLoading() {
  return <CandidateProfile view={{ status: 'loading' }} />;
}
