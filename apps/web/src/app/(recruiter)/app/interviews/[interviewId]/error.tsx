'use client';

import { Scorecard } from '@/features/scorecard/components/Scorecard.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function ScorecardError({ retry }: { error: unknown; retry: () => void }) {
  return <Scorecard view={{ status: 'error', onRetry: retry }} />;
}
