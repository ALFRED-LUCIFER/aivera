'use client';

import { Compare } from '@/features/compare/components/Compare.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function CompareError({ retry }: { error: unknown; retry: () => void }) {
  return <Compare view={{ status: 'error', onRetry: retry }} />;
}
