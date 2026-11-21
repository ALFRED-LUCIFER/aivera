'use client';

import { ApplicantList } from '@/features/add-applicants/components/ApplicantList.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function CandidatesError({ retry }: { error: unknown; retry: () => void }) {
  return <ApplicantList view={{ status: 'error', onRetry: retry }} />;
}
