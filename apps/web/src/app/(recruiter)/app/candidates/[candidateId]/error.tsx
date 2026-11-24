'use client';

import { CandidateProfile } from '@/features/evidence-profile/components/CandidateProfile.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function CandidateProfileError({ retry }: { error: unknown; retry: () => void }) {
  return <CandidateProfile view={{ status: 'error', onRetry: retry }} />;
}
