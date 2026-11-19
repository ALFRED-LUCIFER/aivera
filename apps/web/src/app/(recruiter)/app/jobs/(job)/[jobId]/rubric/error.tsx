'use client';

import { Rubric } from '@/features/rubric/components/Rubric.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function RubricError({ retry }: { error: unknown; retry: () => void }) {
  return <Rubric state={{ status: 'error', onRetry: retry }} />;
}
