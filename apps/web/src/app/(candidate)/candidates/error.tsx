'use client';

import { PageFailed } from '@/features/candidate-shell/components/PageFailed.tsx';

// Any candidate page with no closer boundary that failed to load, including the account reads in sign-up and the
// My applications layout (AIV-P3-007 X4); the reason is in the server log.
export default function CandidatePageError({ retry }: { error: unknown; retry: () => void }) {
  return <PageFailed onRetry={() => retry()} />;
}
